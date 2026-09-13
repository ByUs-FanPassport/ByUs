// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { IEAS } from "./interfaces/IEAS.sol";
import { ByUsActionCodec } from "./ByUsActionCodec.sol";
import { IByUsPublicContextRegistry } from "./interfaces/IByUsPublicContextRegistry.sol";

contract ByUsActionHub is Initializable, UUPSUpgradeable {
    enum OperationKind {
        RECORD_ONLY,
        RECORD_AND_ISSUE,
        IMPORT_HISTORICAL,
        CORRECT
    }

    enum Origin {
        NATIVE,
        HISTORICAL
    }

    enum ActionStatus {
        NONE,
        PENDING,
        ACTIVE,
        INVALIDATED
    }

    enum CredentialKind {
        PASSPORT,
        STAMP,
        COLLECTIBLE
    }

    enum IntentMode {
        MINT,
        LINK_EXISTING
    }

    enum LinkOrigin {
        MINTED_NOW,
        LINKED_EXISTING
    }

    struct ActionRequest {
        bytes32 sourceOccurrence;
        uint32 revision;
        uint16 actionCode;
        uint16 schemaVersion;
        uint32 policyVersion;
        address fan;
        bytes32 creatorId;
        bytes32 campaignId;
        uint32 occurredDay;
        bytes32 evidenceCommitment;
        bytes32 migrationBatchId;
        uint32 bindingVersion;
    }

    struct InitializationConfig {
        address admin;
        address writer;
        address migrator;
        address corrector;
        address pauser;
        address easAddress;
        bytes32 environmentId;
        bytes32 schemaUID;
        address passport;
        address stamp;
        address collectible;
        address codec;
        address contextRegistry;
    }

    struct CredentialIntent {
        CredentialKind kind;
        IntentMode mode;
        bytes32 issuanceKey;
        uint256 tokenId;
        string metadataUri;
    }

    struct CredentialRef {
        address nftContract;
        uint256 tokenId;
        CredentialKind kind;
        bytes32 issuanceKey;
        LinkOrigin linkOrigin;
    }

    struct ActionResult {
        bytes32 actionId;
        bytes32 easUID;
        bytes32 requestHash;
        bytes32 recordHash;
    }

    struct ActionRecord {
        bytes32 occurrenceId;
        bytes32 actionId;
        bytes32 easUID;
        bytes32 requestHash;
        bytes32 recordHash;
        bytes32 schemaUID;
        bytes32 refUID;
        address fan;
        uint32 revision;
        uint16 actionCode;
        uint16 schemaVersion;
        uint32 policyVersion;
        ActionStatus status;
        Origin origin;
        bytes32 migrationBatchId;
    }

    struct MigrationBatch {
        bytes32 root;
        uint64 expiresAt;
        uint32 maxMints;
        uint32 mintsUsed;
        bool closed;
    }

    /// @custom:storage-location erc7201:byus.storage.ActionHub
    struct HubStorage {
        bytes32 environmentId;
        IEAS eas;
        bytes32 schemaUID;
        address passport;
        address stamp;
        address collectible;
        ByUsActionCodec codec;
        IByUsPublicContextRegistry contextRegistry;
        bool paused;
        uint256 entered;
        mapping(bytes32 role => mapping(address account => bool enabled)) roles;
        mapping(bytes32 actionId => ActionRecord record) actions;
        mapping(bytes32 occurrenceId => bytes32 actionId) latestActions;
        mapping(bytes32 credentialKey => bytes32 occurrenceId) credentialOccurrences;
        mapping(bytes32 batchId => MigrationBatch batch) migrationBatches;
        mapping(bytes32 policyKey => bool approved) recordOnlyPolicies;
    }

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant WRITER_ROLE = keccak256("WRITER_ROLE");
    bytes32 public constant MIGRATOR_ROLE = keccak256("MIGRATOR_ROLE");
    bytes32 public constant CORRECTOR_ROLE = keccak256("CORRECTOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    uint8 private constant PASSPORT_MASK = uint8(1 << uint8(CredentialKind.PASSPORT));
    uint8 private constant STAMP_MASK = uint8(1 << uint8(CredentialKind.STAMP));
    uint8 private constant COLLECTIBLE_MASK = uint8(1 << uint8(CredentialKind.COLLECTIBLE));

    // keccak256(abi.encode(uint256(keccak256("byus.storage.ActionHub")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant HUB_STORAGE =
        0x9b4561162b6d58cdaee430aa4073a2ec544ff4ca21320ef4e942bd0b419f7700;
    bytes32 private constant CODEC_CODEHASH =
        0xe3095c9a1847be6e857e06f7182d417597094331c3a2ab5b2058253ab248bc39;

    error AccessDenied();
    error ZeroAddress();
    error ZeroValue();
    error Paused();
    error NotPaused();
    error Reentrancy();
    error UnsupportedAction();
    error InvalidActionContext();
    error InvalidRevision();
    error InvalidOrigin();
    error UnsupportedSchema();
    error UnsupportedBinding();
    error InvalidCredentialPolicy();
    error InvalidCredentialIntent(uint256 index);
    error CredentialAlreadyLinked();
    error ActionRequestConflict(bytes32 actionId, bytes32 storedHash, bytes32 suppliedHash);
    error ActionNotFound();
    error ActionNotActive();
    error LatestActionMismatch();
    error EASReturnedZeroUID();
    error MigrationBatchInvalid();
    error MigrationBatchLimit();
    error InvalidMigrationProof();
    error AlreadyRegistered();
    error ExistingCredentialMismatch(uint256 index);
    error CorrectionCannotMint();
    error InvalidCodec();
    error InvalidTimelock();
    error InvalidRoleSeparation();

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event PausedStateChanged(bool paused, address indexed sender);
    event SchemaRegistered(uint16 indexed schemaVersion, bytes32 indexed schemaUID);
    event AssetBindingRegistered(
        uint32 indexed bindingVersion, CredentialKind indexed kind, address indexed nftContract
    );
    event MigrationBatchRegistered(
        bytes32 indexed batchId, bytes32 indexed root, uint64 expiresAt, uint32 maxMints
    );
    event MigrationBatchClosed(bytes32 indexed batchId);
    event RecordOnlyPolicyRegistered(uint16 indexed actionCode, uint32 indexed policyVersion);
    event FanActionRecorded(
        bytes32 indexed actionId,
        address indexed fan,
        bytes32 indexed campaignId,
        bytes32 occurrenceId,
        uint32 revision,
        bytes32 creatorId,
        string actionName,
        uint16 schemaVersion,
        uint32 policyVersion,
        bytes32 easUID,
        uint32 occurredDay,
        Origin origin,
        bytes32 migrationBatchId
    );
    event CredentialLinked(
        bytes32 indexed actionId,
        address indexed nftContract,
        uint256 indexed tokenId,
        CredentialKind credentialKind,
        bytes32 issuanceKey,
        LinkOrigin linkOrigin
    );
    event FanActionInvalidated(bytes32 indexed actionId, bytes32 indexed easUID, uint16 reasonCode);
    event FanActionCorrected(
        bytes32 indexed previousActionId, bytes32 indexed newActionId, bytes32 indexed occurrenceId
    );

    modifier onlyRole(bytes32 role) {
        if (!_getStorage().roles[role][msg.sender]) revert AccessDenied();
        _;
    }

    modifier whenNotPaused() {
        if (_getStorage().paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        HubStorage storage $ = _getStorage();
        if ($.entered == 2) revert Reentrancy();
        $.entered = 2;
        _;
        $.entered = 1;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(InitializationConfig calldata config) external initializer {
        if (
            config.admin == address(0) || config.writer == address(0)
                || config.migrator == address(0) || config.corrector == address(0)
                || config.pauser == address(0) || config.easAddress == address(0)
                || config.passport == address(0) || config.stamp == address(0)
                || config.codec == address(0) || config.contextRegistry == address(0)
        ) revert ZeroAddress();
        if (config.environmentId == bytes32(0) || config.schemaUID == bytes32(0)) {
            revert ZeroValue();
        }

        HubStorage storage $ = _getStorage();
        if (config.codec.codehash != CODEC_CODEHASH) revert InvalidCodec();
        if (!_isValidTimelock(config.admin)) revert InvalidTimelock();
        if (
            config.writer == config.admin || config.writer == config.migrator
                || config.writer == config.corrector || config.writer == config.pauser
        ) revert InvalidRoleSeparation();
        $.environmentId = config.environmentId;
        $.eas = IEAS(config.easAddress);
        $.entered = 1;
        _grantRole($, DEFAULT_ADMIN_ROLE, config.admin);
        _grantRole($, UPGRADER_ROLE, config.admin);
        _grantRole($, WRITER_ROLE, config.writer);
        _grantRole($, MIGRATOR_ROLE, config.migrator);
        _grantRole($, CORRECTOR_ROLE, config.corrector);
        _grantRole($, PAUSER_ROLE, config.pauser);

        $.schemaUID = config.schemaUID;
        $.passport = config.passport;
        $.stamp = config.stamp;
        $.collectible = config.collectible;
        $.codec = ByUsActionCodec(config.codec);
        $.contextRegistry = IByUsPublicContextRegistry(config.contextRegistry);
        emit SchemaRegistered(1, config.schemaUID);
        emit AssetBindingRegistered(1, CredentialKind.PASSPORT, config.passport);
        emit AssetBindingRegistered(1, CredentialKind.STAMP, config.stamp);
        if (config.collectible != address(0)) {
            emit AssetBindingRegistered(1, CredentialKind.COLLECTIBLE, config.collectible);
        }
    }

    function recordOnly(ActionRequest calldata request)
        external
        onlyRole(WRITER_ROLE)
        whenNotPaused
        nonReentrant
        returns (ActionResult memory)
    {
        CredentialIntent[] memory intents = new CredentialIntent[](0);
        return _record(OperationKind.RECORD_ONLY, request, intents, Origin.NATIVE, bytes32(0));
    }

    function recordAndIssue(ActionRequest calldata request, CredentialIntent[] calldata intents)
        external
        onlyRole(WRITER_ROLE)
        whenNotPaused
        nonReentrant
        returns (ActionResult memory)
    {
        return _record(OperationKind.RECORD_AND_ISSUE, request, intents, Origin.NATIVE, bytes32(0));
    }

    function importHistorical(
        ActionRequest calldata request,
        CredentialIntent[] calldata intents,
        bytes32[] calldata merkleProof
    ) external onlyRole(MIGRATOR_ROLE) whenNotPaused nonReentrant returns (ActionResult memory) {
        HubStorage storage $ = _getStorage();
        bytes32 occurrenceId = computeOccurrenceId(request.sourceOccurrence);
        bytes32 actionId = computeActionId(occurrenceId, request.revision);
        bytes32 requestHash = hashRequest(OperationKind.IMPORT_HISTORICAL, request, intents);
        ActionRecord storage existing = $.actions[actionId];
        if (existing.status != ActionStatus.NONE) return _idempotent(existing, requestHash);

        MigrationBatch storage batch = $.migrationBatches[request.migrationBatchId];
        if (
            request.migrationBatchId == bytes32(0) || batch.root == bytes32(0) || batch.closed
                || block.timestamp > batch.expiresAt
        ) revert MigrationBatchInvalid();
        bytes32 leaf =
            keccak256(abi.encode(request.migrationBatchId, $.environmentId, actionId, requestHash));
        if (!$.codec.verifyMerkle(merkleProof, batch.root, leaf)) {
            revert InvalidMigrationProof();
        }
        uint32 mintCount = _countMints(intents);
        if (uint256(batch.mintsUsed) + mintCount > batch.maxMints) {
            revert MigrationBatchLimit();
        }
        batch.mintsUsed += mintCount;
        return _record(
            OperationKind.IMPORT_HISTORICAL, request, intents, Origin.HISTORICAL, requestHash
        );
    }

    function invalidate(bytes32 actionId, uint16 reasonCode)
        external
        onlyRole(CORRECTOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bool changed)
    {
        HubStorage storage $ = _getStorage();
        ActionRecord storage record = $.actions[actionId];
        if (record.status == ActionStatus.NONE) revert ActionNotFound();
        if (record.status == ActionStatus.INVALIDATED) return false;
        if (record.status != ActionStatus.ACTIVE) revert ActionNotActive();
        _revoke($, record);
        record.status = ActionStatus.INVALIDATED;
        emit FanActionInvalidated(actionId, record.easUID, reasonCode);
        return true;
    }

    function correct(
        bytes32 expectedPreviousActionId,
        ActionRequest calldata request,
        CredentialIntent[] calldata linkExisting
    ) external onlyRole(CORRECTOR_ROLE) whenNotPaused nonReentrant returns (ActionResult memory) {
        HubStorage storage $ = _getStorage();
        bytes32 occurrenceId = computeOccurrenceId(request.sourceOccurrence);
        bytes32 actionId = computeActionId(occurrenceId, request.revision);
        bytes32 requestHash = hashRequest(OperationKind.CORRECT, request, linkExisting);
        ActionRecord storage existing = $.actions[actionId];
        if (existing.status != ActionStatus.NONE) return _idempotent(existing, requestHash);

        bytes32 actualPrevious = $.latestActions[occurrenceId];
        if (actualPrevious != expectedPreviousActionId) {
            revert LatestActionMismatch();
        }
        ActionRecord storage previous = $.actions[actualPrevious];
        if (previous.status != ActionStatus.ACTIVE && previous.status != ActionStatus.INVALIDATED) {
            revert ActionNotActive();
        }
        if (request.revision != previous.revision + 1) {
            revert InvalidRevision();
        }
        for (uint256 i; i < linkExisting.length; ++i) {
            if (linkExisting[i].mode != IntentMode.LINK_EXISTING) revert CorrectionCannotMint();
        }
        if (previous.status == ActionStatus.ACTIVE) {
            _revoke($, previous);
            previous.status = ActionStatus.INVALIDATED;
            emit FanActionInvalidated(previous.actionId, previous.easUID, 0);
        }
        Origin previousOrigin = previous.origin;
        if (request.migrationBatchId != previous.migrationBatchId) {
            revert InvalidOrigin();
        }
        ActionResult memory result =
            _record(OperationKind.CORRECT, request, linkExisting, previousOrigin, requestHash);
        emit FanActionCorrected(previous.actionId, result.actionId, occurrenceId);
        return result;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        HubStorage storage $ = _getStorage();
        if ($.paused) revert Paused();
        $.paused = true;
        emit PausedStateChanged(true, msg.sender);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        HubStorage storage $ = _getStorage();
        if (!$.paused) revert NotPaused();
        $.paused = false;
        emit PausedStateChanged(false, msg.sender);
    }

    function setRole(bytes32 role, address account, bool enabled)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert ZeroAddress();
        HubStorage storage $ = _getStorage();
        if (enabled) {
            _grantRole($, role, account);
        } else if ($.roles[role][account]) {
            $.roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    function registerMigrationBatch(
        bytes32 batchId,
        bytes32 root,
        uint64 expiresAt,
        uint32 maxMints
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        HubStorage storage $ = _getStorage();
        if (batchId == bytes32(0) || root == bytes32(0)) revert ZeroValue();
        if (expiresAt <= block.timestamp) revert MigrationBatchInvalid();
        if ($.migrationBatches[batchId].root != bytes32(0)) revert AlreadyRegistered();
        $.migrationBatches[batchId] = MigrationBatch(root, expiresAt, maxMints, 0, false);
        emit MigrationBatchRegistered(batchId, root, expiresAt, maxMints);
    }

    function registerRecordOnlyPolicy(uint16 actionCode, uint32 policyVersion)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (actionCode == 0 || actionCode > 11 || policyVersion <= 1) {
            revert UnsupportedAction();
        }
        bytes32 key = keccak256(abi.encode(actionCode, policyVersion));
        if (_getStorage().recordOnlyPolicies[key]) revert AlreadyRegistered();
        _getStorage().recordOnlyPolicies[key] = true;
        emit RecordOnlyPolicyRegistered(actionCode, policyVersion);
    }

    function closeMigrationBatch(bytes32 batchId) external {
        HubStorage storage $ = _getStorage();
        if (!$.roles[PAUSER_ROLE][msg.sender] && !$.roles[DEFAULT_ADMIN_ROLE][msg.sender]) {
            revert AccessDenied();
        }
        MigrationBatch storage batch = $.migrationBatches[batchId];
        if (batch.root == bytes32(0) || batch.closed) revert MigrationBatchInvalid();
        batch.closed = true;
        emit MigrationBatchClosed(batchId);
    }

    function environmentId() external view returns (bytes32) {
        return _getStorage().environmentId;
    }

    function eas() external view returns (address) {
        return address(_getStorage().eas);
    }

    function getSchema(uint16 schemaVersion) external view returns (bytes32) {
        return schemaVersion == 1 ? _getStorage().schemaUID : bytes32(0);
    }

    function getAssetBinding(uint32 bindingVersion, CredentialKind kind)
        public
        view
        returns (address)
    {
        if (bindingVersion != 1) return address(0);
        HubStorage storage $ = _getStorage();
        if (kind == CredentialKind.PASSPORT) return $.passport;
        if (kind == CredentialKind.STAMP) return $.stamp;
        return $.collectible;
    }

    function getAction(bytes32 actionId) external view returns (ActionRecord memory) {
        return _getStorage().actions[actionId];
    }

    function latestActionId(bytes32 occurrenceId) external view returns (bytes32) {
        return _getStorage().latestActions[occurrenceId];
    }

    function computeOccurrenceId(bytes32 sourceOccurrence) public view returns (bytes32) {
        HubStorage storage $ = _getStorage();
        return
            keccak256(abi.encode(block.chainid, address(this), $.environmentId, sourceOccurrence));
    }

    function computeActionId(bytes32 occurrenceId, uint32 revision) public pure returns (bytes32) {
        return keccak256(abi.encode(occurrenceId, revision));
    }

    function _credentialKey(address nftContract, uint256 tokenId) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, nftContract, tokenId));
    }

    function hashRequest(
        OperationKind operation,
        ActionRequest calldata request,
        CredentialIntent[] calldata intents
    ) public view returns (bytes32) {
        (bool ok, bytes memory result) = address(_getStorage().codec)
            .staticcall(
                abi.encodeWithSelector(
                    ByUsActionCodec.hashRequest.selector, uint8(operation), request, intents
                )
            );
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        return abi.decode(result, (bytes32));
    }

    function _record(
        OperationKind operation,
        ActionRequest calldata request,
        CredentialIntent[] memory intents,
        Origin origin,
        bytes32 precomputedRequestHash
    ) internal returns (ActionResult memory) {
        HubStorage storage $ = _getStorage();
        bytes32 occurrenceId = computeOccurrenceId(request.sourceOccurrence);
        bytes32 actionId = computeActionId(occurrenceId, request.revision);
        bytes32 requestHash = precomputedRequestHash == bytes32(0)
            ? this.hashRequest(operation, request, intents)
            : precomputedRequestHash;
        ActionRecord storage existing = $.actions[actionId];
        if (existing.status != ActionStatus.NONE) return _idempotent(existing, requestHash);

        _validateRequest($, operation, request, intents, origin);
        $.actions[actionId].status = ActionStatus.PENDING;
        CredentialRef[] memory refs = _executeIntents($, occurrenceId, request, intents);
        _sortRefs(refs);
        bytes32 refsHash = keccak256(abi.encode(refs));
        bytes32 refUID = operation == OperationKind.CORRECT
            ? $.actions[$.latestActions[occurrenceId]].easUID
            : bytes32(0);
        bytes memory easData = abi.encode(
            occurrenceId,
            actionId,
            request.revision,
            request.actionCode,
            request.schemaVersion,
            request.policyVersion,
            $.environmentId,
            request.creatorId,
            request.campaignId,
            request.occurredDay,
            origin,
            request.evidenceCommitment,
            refsHash,
            request.migrationBatchId
        );
        bytes32 recordHash = keccak256(easData);
        bytes32 schemaUID = $.schemaUID;
        bytes32 easUID = abi.decode(
            _delegateCodec(
                abi.encodeCall(
                    ByUsActionCodec.attestAction,
                    (address($.eas), schemaUID, request.fan, refUID, easData)
                )
            ),
            (bytes32)
        );
        if (easUID == bytes32(0)) revert EASReturnedZeroUID();

        ActionRecord storage record = $.actions[actionId];
        record.occurrenceId = occurrenceId;
        record.actionId = actionId;
        record.easUID = easUID;
        record.requestHash = requestHash;
        record.recordHash = recordHash;
        record.schemaUID = schemaUID;
        record.refUID = refUID;
        record.fan = request.fan;
        record.revision = request.revision;
        record.actionCode = request.actionCode;
        record.schemaVersion = request.schemaVersion;
        record.policyVersion = request.policyVersion;
        record.status = ActionStatus.ACTIVE;
        record.origin = origin;
        record.migrationBatchId = request.migrationBatchId;
        $.latestActions[occurrenceId] = actionId;

        for (uint256 i; i < refs.length; ++i) {
            CredentialRef memory ref = refs[i];
            bytes32 credentialKey = _credentialKey(ref.nftContract, ref.tokenId);
            bytes32 linkedOccurrence = $.credentialOccurrences[credentialKey];
            if (linkedOccurrence != bytes32(0) && linkedOccurrence != occurrenceId) {
                revert CredentialAlreadyLinked();
            }
            $.credentialOccurrences[credentialKey] = occurrenceId;
            emit CredentialLinked(
                actionId, ref.nftContract, ref.tokenId, ref.kind, ref.issuanceKey, ref.linkOrigin
            );
        }
        _delegateCodec(
            abi.encodeWithSelector(
                ByUsActionCodec.emitFanActionRecorded.selector,
                actionId,
                occurrenceId,
                easUID,
                uint8(origin),
                request
            )
        );
        return ActionResult(actionId, easUID, requestHash, recordHash);
    }

    function _validateRequest(
        HubStorage storage $,
        OperationKind operation,
        ActionRequest calldata request,
        CredentialIntent[] memory intents,
        Origin origin
    ) internal view {
        if (request.sourceOccurrence == bytes32(0) || request.fan == address(0)) revert ZeroValue();
        if (request.revision == 0) revert InvalidRevision();
        if (operation != OperationKind.CORRECT && request.revision != 1) {
            revert InvalidRevision();
        }
        if (request.occurredDay == 0 || request.occurredDay > block.timestamp / 1 days) {
            revert InvalidActionContext();
        }
        if (request.schemaVersion != 1 || $.schemaUID == bytes32(0)) {
            revert UnsupportedSchema();
        }
        bool recordOnlyPolicy =
            $.recordOnlyPolicies[keccak256(abi.encode(request.actionCode, request.policyVersion))];
        if (
            request.actionCode == 0 || request.actionCode > 11
                || (request.policyVersion != 1 && !recordOnlyPolicy)
        ) {
            revert UnsupportedAction();
        }
        if (
            (_requiresCreator(request.actionCode) && request.creatorId == bytes32(0))
                || (_requiresCampaign(request.actionCode) && request.campaignId == bytes32(0))
        ) revert InvalidActionContext();
        if (!$.contextRegistry.isValidContext(request.creatorId, request.campaignId)) {
            revert InvalidActionContext();
        }
        if (
            (origin == Origin.NATIVE && request.migrationBatchId != bytes32(0))
                || (origin == Origin.HISTORICAL && request.migrationBatchId == bytes32(0))
        ) revert InvalidOrigin();
        if (operation == OperationKind.RECORD_ONLY) {
            if (!recordOnlyPolicy || intents.length != 0) revert InvalidCredentialPolicy();
            return;
        }
        if (operation == OperationKind.IMPORT_HISTORICAL && intents.length == 0) {
            if (!recordOnlyPolicy) revert InvalidCredentialPolicy();
            return;
        }
        if (operation == OperationKind.CORRECT && intents.length == 0 && recordOnlyPolicy) return;
        if (request.policyVersion != 1) revert InvalidCredentialPolicy();
        uint8 expectedMask = request.actionCode == 1
            ? PASSPORT_MASK | STAMP_MASK
            : (request.actionCode == 11 ? COLLECTIBLE_MASK : STAMP_MASK);
        uint256 expectedCount = request.actionCode == 1 ? 2 : 1;
        if (
            (operation == OperationKind.CORRECT && intents.length > expectedCount)
                || (operation != OperationKind.CORRECT && intents.length != expectedCount)
        ) {
            revert InvalidCredentialPolicy();
        }
        uint8 seenMask;
        for (uint256 i; i < intents.length; ++i) {
            uint8 kindMask = uint8(1 << uint8(intents[i].kind));
            if ((expectedMask & kindMask) == 0 || (seenMask & kindMask) != 0) {
                revert InvalidCredentialPolicy();
            }
            seenMask |= kindMask;
            if (getAssetBinding(request.bindingVersion, intents[i].kind) == address(0)) {
                revert UnsupportedBinding();
            }
            _validateIntentOrder(intents, i);
        }
        if (operation != OperationKind.CORRECT && seenMask != expectedMask) {
            revert InvalidCredentialPolicy();
        }
    }

    function _executeIntents(
        HubStorage storage $,
        bytes32 occurrenceId,
        ActionRequest calldata request,
        CredentialIntent[] memory intents
    ) internal returns (CredentialRef[] memory refs) {
        refs = new CredentialRef[](intents.length);
        for (uint256 i; i < intents.length; ++i) {
            CredentialIntent memory intent = intents[i];
            address nft = getAssetBinding(request.bindingVersion, intent.kind);
            bytes memory result = _delegateCodec(
                abi.encodeCall(
                    ByUsActionCodec.executeIntent,
                    (
                        uint8(intent.kind),
                        uint8(intent.mode),
                        nft,
                        request.fan,
                        intent.issuanceKey,
                        intent.tokenId,
                        intent.metadataUri
                    )
                )
            );
            (uint256 tokenId, uint8 rawLinkOrigin) = abi.decode(result, (uint256, uint8));
            LinkOrigin linkOrigin = LinkOrigin(rawLinkOrigin);
            bytes32 credentialKey = _credentialKey(nft, tokenId);
            bytes32 linkedOccurrence = $.credentialOccurrences[credentialKey];
            if (linkedOccurrence != bytes32(0) && linkedOccurrence != occurrenceId) {
                revert CredentialAlreadyLinked();
            }
            refs[i] = CredentialRef(nft, tokenId, intent.kind, intent.issuanceKey, linkOrigin);
        }
    }

    function _revoke(HubStorage storage $, ActionRecord storage record) internal {
        _delegateCodec(
            abi.encodeCall(
                ByUsActionCodec.revokeAction, (address($.eas), record.schemaUID, record.easUID)
            )
        );
    }

    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _delegateCodec(bytes memory callData) internal returns (bytes memory result) {
        (bool ok, bytes memory returned) = address(_getStorage().codec).delegatecall(callData);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(returned, 32), mload(returned))
            }
        }
        return returned;
    }

    function _idempotent(ActionRecord storage record, bytes32 requestHash)
        internal
        view
        returns (ActionResult memory)
    {
        if (record.requestHash != requestHash) {
            revert ActionRequestConflict(record.actionId, record.requestHash, requestHash);
        }
        return ActionResult(record.actionId, record.easUID, record.requestHash, record.recordHash);
    }

    function _countMints(CredentialIntent[] calldata intents) internal pure returns (uint32 count) {
        for (uint256 i; i < intents.length; ++i) {
            if (intents[i].mode == IntentMode.MINT) ++count;
        }
    }

    function _validateIntentOrder(CredentialIntent[] memory intents, uint256 index) internal pure {
        if (index == 0) return;
        CredentialIntent memory previous = intents[index - 1];
        CredentialIntent memory current = intents[index];
        if (uint8(previous.kind) >= uint8(current.kind)) revert InvalidCredentialIntent(index);
    }

    function _sortRefs(CredentialRef[] memory refs) internal pure {
        for (uint256 i = 1; i < refs.length; ++i) {
            CredentialRef memory current = refs[i];
            uint256 j = i;
            while (j > 0 && _refAfter(refs[j - 1], current)) {
                refs[j] = refs[j - 1];
                --j;
            }
            refs[j] = current;
        }
    }

    function _refAfter(CredentialRef memory a, CredentialRef memory b)
        internal
        pure
        returns (bool)
    {
        return uint160(a.nftContract) > uint160(b.nftContract)
            || (a.nftContract == b.nftContract && a.tokenId > b.tokenId);
    }

    function _requiresCampaign(uint16 code) internal pure returns (bool) {
        return code >= 2 && code <= 5 || code == 11;
    }

    function _requiresCreator(uint16 code) internal pure returns (bool) {
        return code != 7 && code != 9;
    }

    function _grantRole(HubStorage storage $, bytes32 role, address account) internal {
        if (!$.roles[role][account]) {
            $.roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function _isValidTimelock(address account) internal view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(abi.encodeWithSignature("getMinDelay()"));
        return ok && data.length == 32 && abi.decode(data, (uint256)) >= 2 days;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }

    function _getStorage() private pure returns (HubStorage storage $) {
        bytes32 slot = HUB_STORAGE;
        assembly {
            $.slot := slot
        }
    }
}
