// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ByUsActionHub } from "../src/ByUsActionHub.sol";
import { ByUsActionCodec } from "../src/ByUsActionCodec.sol";
import { ByUsPublicContextRegistry } from "../src/ByUsPublicContextRegistry.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { ByUsStamp } from "../src/ByUsStamp.sol";
import { ByUsCollectible } from "../src/ByUsCollectible.sol";
import { IEAS } from "../src/interfaces/IEAS.sol";
import { MockEAS } from "../src/mocks/MockEAS.sol";

import { ByUsActionHubContextV2 } from "../src/ByUsActionHubContextV2.sol";
import { ByUsPublicContextRegistryV2 } from "../src/ByUsPublicContextRegistryV2.sol";

contract ByUsActionHubV2 is ByUsActionHub {
    function implementationVersion() external pure returns (uint256) {
        return 2;
    }
}

contract ReenteringFan is IERC721Receiver, IERC1155Receiver {
    address public hub;
    bytes public attackData;
    uint256 public attempts;
    uint256 public successes;

    function arm(address hub_, bytes calldata attackData_) external {
        hub = hub_;
        attackData = attackData_;
    }

    function _attack() internal {
        if (hub != address(0)) {
            ++attempts;
            (bool success,) = hub.call(attackData);
            if (success) ++successes;
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        _attack();
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        _attack();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IERC1155Receiver).interfaceId;
    }
}

contract RejectingStampReceiver is IERC721Receiver, IERC1155Receiver {
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("REJECT_STAMP");
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert("REJECT_STAMP");
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IERC1155Receiver).interfaceId;
    }
}

contract ByUsActionHubTest is Test {
    address internal admin;
    address internal writer = makeAddr("writer");
    address internal migrator = makeAddr("migrator");
    address internal corrector = makeAddr("corrector");
    address internal pauser = makeAddr("pauser");
    address internal fan = makeAddr("fan");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant ENVIRONMENT_ID = keccak256("GIWA_SEPOLIA_DEV");
    bytes32 internal constant SCHEMA_UID = keccak256("BYUS_ACTION_V1");
    bytes32 internal constant CREATOR_ID = keccak256("creator-public-id");
    bytes32 internal constant CAMPAIGN_ID = keccak256("live-public-id");

    MockEAS internal eas;
    ByUsPassport internal passport;
    ByUsStamp internal stamp;
    ByUsCollectible internal collectible;
    ByUsActionHub internal implementation;
    ByUsActionHub internal hub;
    ByUsActionCodec internal codec;
    ByUsPublicContextRegistry internal contextRegistry;
    TimelockController internal timelock;

    function setUp() public {
        vm.warp(2_000_000_000);
        address[] memory proposers = new address[](1);
        proposers[0] = address(this);
        address[] memory executors = new address[](1);
        executors[0] = address(this);
        timelock = new TimelockController(2 days, proposers, executors, address(0));
        admin = address(timelock);
        eas = new MockEAS();
        passport = new ByUsPassport(admin, writer);
        stamp = new ByUsStamp(admin, writer);
        collectible = new ByUsCollectible(admin, writer);
        contextRegistry = new ByUsPublicContextRegistry(admin);
        implementation = new ByUsActionHub();
        codec = new ByUsActionCodec();
        ByUsActionHub.InitializationConfig memory config = ByUsActionHub.InitializationConfig({
            admin: admin,
            writer: writer,
            migrator: migrator,
            corrector: corrector,
            pauser: pauser,
            easAddress: address(eas),
            environmentId: ENVIRONMENT_ID,
            schemaUID: SCHEMA_UID,
            passport: address(passport),
            stamp: address(stamp),
            collectible: address(collectible),
            codec: address(codec),
            contextRegistry: address(contextRegistry)
        });
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation), abi.encodeCall(ByUsActionHub.initialize, config)
        );
        hub = ByUsActionHub(address(proxy));

        vm.startPrank(admin);
        contextRegistry.registerCreator(CREATOR_ID, "creator-public");
        contextRegistry.registerCampaign(CAMPAIGN_ID, CREATOR_ID, "live-public");
        passport.grantRole(passport.MINTER_ROLE(), address(hub));
        stamp.grantRole(stamp.MINTER_ROLE(), address(hub));
        collectible.grantRole(collectible.MINTER_ROLE(), address(hub));
        vm.stopPrank();
    }

    function testT01ActionClassificationAndUnsupportedCode() public {
        assertEq(codec.actionName(2), "LIVE_RESERVED");
        assertEq(codec.actionName(3), "LIVE_ATTENDED");
        assertEq(codec.actionName(4), "MISSION_COMPLETED");
        assertEq(codec.actionName(5), "SURVEY_SUBMITTED");

        ByUsActionHub.ActionRequest memory request = _request(keccak256("unsupported"), 99, fan);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("unsupported");
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.UnsupportedAction.selector);
        hub.recordAndIssue(request, intents);
    }

    function testT01RejectsUnknownInactiveAndWrongCreatorContexts() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("unknown"), 2, fan);
        request.creatorId = keccak256("unknown-creator");
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.InvalidActionContext.selector);
        hub.recordAndIssue(request, _stampIntent("unknown"));

        vm.prank(admin);
        contextRegistry.setCampaignActive(CAMPAIGN_ID, false);
        request = _request(keccak256("inactive"), 2, fan);
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.InvalidActionContext.selector);
        hub.recordAndIssue(request, _stampIntent("inactive"));

        bytes32 otherCreator = keccak256("other-creator");
        vm.startPrank(admin);
        contextRegistry.setCampaignActive(CAMPAIGN_ID, true);
        contextRegistry.registerCreator(otherCreator, "other-creator");
        vm.stopPrank();
        request = _request(keccak256("wrong-creator"), 2, fan);
        request.creatorId = otherCreator;
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.InvalidActionContext.selector);
        hub.recordAndIssue(request, _stampIntent("wrong-creator"));
    }

    function testT02FanVerifiedMintsTwoCredentialsInOneAction() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("quiz-1"), 1, fan);
        request.campaignId = bytes32(0);
        ByUsActionHub.CredentialIntent[] memory intents = _fanVerifiedIntents("quiz-1");

        vm.prank(writer);
        ByUsActionHub.ActionResult memory result = hub.recordAndIssue(request, intents);
        emit log_named_uint("gas.two_nft", vm.snapshotGasLastCall("two_nft"));

        assertEq(eas.attestCount(), 1);
        assertEq(passport.ownerOf(1), fan);
        assertEq(stamp.balanceOf(fan, 1), 1);
        assertEq(passport.ownerOf(1), fan);
        assertTrue(_isCurrentEasValid(result.actionId));
    }

    function testT03IdenticalRetryHasNoNewMintAttestationOrLogs() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("retry"), 2, fan);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("retry");
        vm.prank(writer);
        ByUsActionHub.ActionResult memory first = hub.recordAndIssue(request, intents);
        emit log_named_uint("gas.single_nft", vm.snapshotGasLastCall("single_nft"));

        vm.recordLogs();
        vm.prank(writer);
        ByUsActionHub.ActionResult memory second = hub.recordAndIssue(request, intents);
        assertEq(first.actionId, second.actionId);
        assertEq(first.easUID, second.easUID);
        assertEq(eas.attestCount(), 1);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function testT04SameActionDifferentPayloadReverts() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("conflict"), 2, fan);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("conflict");
        vm.prank(writer);
        hub.recordAndIssue(request, intents);

        intents[0].metadataUri = "ipfs://changed";
        bytes32 occurrenceId = hub.computeOccurrenceId(request.sourceOccurrence);
        bytes32 actionId = hub.computeActionId(occurrenceId, 1);
        bytes32 storedHash = hub.getAction(actionId).requestHash;
        bytes32 suppliedHash =
            hub.hashRequest(ByUsActionHub.OperationKind.RECORD_AND_ISSUE, request, intents);
        vm.prank(writer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ByUsActionHub.ActionRequestConflict.selector, actionId, storedHash, suppliedHash
            )
        );
        hub.recordAndIssue(request, intents);
    }

    function testT05EASFailureRollsBackNFTAndHubState() public {
        eas.setFailAttest(true);
        ByUsActionHub.ActionRequest memory request = _request(keccak256("atomic"), 2, fan);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("atomic");
        vm.prank(writer);
        vm.expectRevert("EAS_FAIL");
        hub.recordAndIssue(request, intents);

        assertEq(stamp.tokenByIssuanceId(intents[0].issuanceKey), 0);
        bytes32 occurrenceId = hub.computeOccurrenceId(request.sourceOccurrence);
        assertEq(hub.latestActionId(occurrenceId), bytes32(0));
    }

    function testT05ZeroEASUidAlsoRollsBack() public {
        eas.setReturnZero(true);
        ByUsActionHub.ActionRequest memory request = _request(keccak256("zero-uid"), 2, fan);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("zero-uid");
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.EASReturnedZeroUID.selector);
        hub.recordAndIssue(request, intents);
        assertEq(stamp.tokenByIssuanceId(intents[0].issuanceKey), 0);
    }

    function testT06ReceiverReentrancyCannotDuplicate() public {
        ReenteringFan receiver = new ReenteringFan();
        ByUsActionHub.ActionRequest memory request =
            _request(keccak256("reenter"), 1, address(receiver));
        request.campaignId = bytes32(0);
        ByUsActionHub.CredentialIntent[] memory intents = _fanVerifiedIntents("reenter");
        bytes memory attack = abi.encodeCall(ByUsActionHub.recordAndIssue, (request, intents));
        receiver.arm(address(hub), attack);
        bytes32 writerRole = hub.WRITER_ROLE();
        vm.prank(admin);
        hub.setRole(writerRole, address(receiver), true);

        vm.prank(writer);
        ByUsActionHub.ActionResult memory result = hub.recordAndIssue(request, intents);
        assertEq(receiver.attempts(), 2);
        assertEq(receiver.successes(), 0);
        assertEq(passport.ownerOf(1), address(receiver));
        assertEq(eas.attestCount(), 1);
    }

    function testT06SecondCredentialRejectionRollsBackFirstMint() public {
        RejectingStampReceiver receiver = new RejectingStampReceiver();
        ByUsActionHub.ActionRequest memory request =
            _request(keccak256("reject-second"), 1, address(receiver));
        request.campaignId = bytes32(0);
        vm.prank(writer);
        vm.expectRevert("REJECT_STAMP");
        hub.recordAndIssue(request, _fanVerifiedIntents("reject-second"));

        assertEq(passport.tokenByPassportId(keccak256(abi.encode("passport", "reject-second"))), 0);
        assertEq(eas.attestCount(), 0);
        assertEq(hub.latestActionId(hub.computeOccurrenceId(request.sourceOccurrence)), bytes32(0));
    }

    function testRecordOnlyRequiresTimelockApprovedImmutablePolicy() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("record-only"), 7, fan);
        request.policyVersion = 2;
        request.creatorId = bytes32(0);
        request.campaignId = bytes32(0);
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.UnsupportedAction.selector);
        hub.recordOnly(request);

        vm.prank(admin);
        hub.registerRecordOnlyPolicy(7, 2);
        vm.prank(writer);
        ByUsActionHub.ActionResult memory result = hub.recordOnly(request);
        emit log_named_uint("gas.record_only", vm.snapshotGasLastCall("record_only"));
        assertEq(eas.attestCount(), 1);
        assertEq(
            uint8(hub.getAction(result.actionId).status), uint8(ByUsActionHub.ActionStatus.ACTIVE)
        );

        request.revision = 2;
        vm.prank(corrector);
        ByUsActionHub.ActionResult memory corrected =
            hub.correct(result.actionId, request, new ByUsActionHub.CredentialIntent[](0));
        assertEq(
            uint8(hub.getAction(corrected.actionId).status),
            uint8(ByUsActionHub.ActionStatus.ACTIVE)
        );
    }

    function testHistoricalNoCredentialRequiresApprovedPolicyAndManifest() public {
        ByUsActionHub.ActionRequest memory request = _historicalRequest(keccak256("h3"), 7);
        request.policyVersion = 2;
        request.creatorId = bytes32(0);
        request.campaignId = bytes32(0);
        ByUsActionHub.CredentialIntent[] memory intents = new ByUsActionHub.CredentialIntent[](0);
        vm.prank(admin);
        hub.registerRecordOnlyPolicy(7, 2);
        _registerSingleLeafBatch(request, intents, 0);
        vm.prank(migrator);
        ByUsActionHub.ActionResult memory result =
            hub.importHistorical(request, intents, new bytes32[](0));
        assertEq(eas.attestCount(), 1);
        assertEq(
            uint8(hub.getAction(result.actionId).status), uint8(ByUsActionHub.ActionStatus.ACTIVE)
        );

        request.revision = 2;
        vm.prank(corrector);
        ByUsActionHub.ActionResult memory corrected =
            hub.correct(result.actionId, request, new ByUsActionHub.CredentialIntent[](0));
        assertEq(
            uint8(hub.getAction(corrected.actionId).origin), uint8(ByUsActionHub.Origin.HISTORICAL)
        );
        assertEq(hub.getAction(corrected.actionId).migrationBatchId, request.migrationBatchId);
        assertEq(hub.getAction(corrected.actionId).policyVersion, 2);
    }

    function testT10HistoricalLinkPreservesExistingNFT() public {
        bytes32 issuanceKey = keccak256("old-attendance");
        vm.prank(writer);
        uint256 tokenId = stamp.mint(fan, issuanceKey, "ipfs://old-attendance");
        ByUsActionHub.ActionRequest memory request = _historicalRequest(keccak256("old-source"), 3);
        ByUsActionHub.CredentialIntent[] memory intents = new ByUsActionHub.CredentialIntent[](1);
        intents[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.LINK_EXISTING,
            issuanceKey: issuanceKey,
            tokenId: tokenId,
            metadataUri: "ipfs://old-attendance"
        });
        _registerSingleLeafBatch(request, intents, 0);

        vm.prank(migrator);
        ByUsActionHub.ActionResult memory result =
            hub.importHistorical(request, intents, new bytes32[](0));
        assertEq(stamp.balanceOf(fan, tokenId), 1);
        assertEq(stamp.tokenByIssuanceId(issuanceKey), tokenId);
    }

    function testT13MigrationRetryAndClosedBatch() public {
        ByUsActionHub.ActionRequest memory request = _historicalRequest(keccak256("migration"), 2);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("migration");
        _registerSingleLeafBatch(request, intents, 1);
        vm.prank(migrator);
        ByUsActionHub.ActionResult memory first =
            hub.importHistorical(request, intents, new bytes32[](0));
        vm.prank(migrator);
        ByUsActionHub.ActionResult memory second =
            hub.importHistorical(request, intents, new bytes32[](0));
        assertEq(first.actionId, second.actionId);
        assertEq(eas.attestCount(), 1);

        vm.prank(pauser);
        hub.closeMigrationBatch(request.migrationBatchId);
        ByUsActionHub.ActionRequest memory other = _historicalRequest(keccak256("other"), 2);
        other.migrationBatchId = request.migrationBatchId;
        vm.prank(migrator);
        vm.expectRevert(ByUsActionHub.MigrationBatchInvalid.selector);
        hub.importHistorical(other, _stampIntent("other"), new bytes32[](0));
    }

    function testT13RejectsWrongLeafExhaustedLimitAndExpiredBatch() public {
        ByUsActionHub.ActionRequest memory approved = _historicalRequest(keccak256("approved"), 2);
        ByUsActionHub.CredentialIntent[] memory approvedIntents = _stampIntent("approved");
        _registerSingleLeafBatch(approved, approvedIntents, 1);

        ByUsActionHub.ActionRequest memory outsider = _historicalRequest(keccak256("outsider"), 2);
        outsider.migrationBatchId = approved.migrationBatchId;
        vm.prank(migrator);
        vm.expectRevert(ByUsActionHub.InvalidMigrationProof.selector);
        hub.importHistorical(outsider, _stampIntent("outsider"), new bytes32[](0));
        assertEq(stamp.tokenByIssuanceId(keccak256("outsider")), 0);

        ByUsActionHub.ActionRequest memory exhausted = _historicalRequest(keccak256("exhausted"), 2);
        ByUsActionHub.CredentialIntent[] memory exhaustedIntents = _stampIntent("exhausted");
        _registerSingleLeafBatch(exhausted, exhaustedIntents, 0);
        vm.prank(migrator);
        vm.expectRevert(ByUsActionHub.MigrationBatchLimit.selector);
        hub.importHistorical(exhausted, exhaustedIntents, new bytes32[](0));

        ByUsActionHub.ActionRequest memory expired = _historicalRequest(keccak256("expired"), 2);
        ByUsActionHub.CredentialIntent[] memory expiredIntents = _stampIntent("expired");
        _registerSingleLeafBatch(expired, expiredIntents, 1);
        vm.warp(block.timestamp + 8 days);
        vm.prank(migrator);
        vm.expectRevert(ByUsActionHub.MigrationBatchInvalid.selector);
        hub.importHistorical(expired, expiredIntents, new bytes32[](0));
    }

    function testT14InvalidateThenCorrectLinksPreviousEAS() public {
        ByUsActionHub.ActionRequest memory original = _request(keccak256("correct"), 2, fan);
        ByUsActionHub.CredentialIntent[] memory minted = _stampIntent("correct");
        vm.prank(writer);
        ByUsActionHub.ActionResult memory first = hub.recordAndIssue(original, minted);
        vm.prank(corrector);
        assertTrue(hub.invalidate(first.actionId, 7));
        vm.prank(corrector);
        assertFalse(hub.invalidate(first.actionId, 7));

        ByUsActionHub.ActionRequest memory corrected = original;
        corrected.revision = 2;
        corrected.actionCode = 3;
        ByUsActionHub.CredentialIntent[] memory links = new ByUsActionHub.CredentialIntent[](1);
        links[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.LINK_EXISTING,
            issuanceKey: minted[0].issuanceKey,
            tokenId: 1,
            metadataUri: minted[0].metadataUri
        });
        vm.prank(corrector);
        ByUsActionHub.ActionResult memory second = hub.correct(first.actionId, corrected, links);
        emit log_named_uint("gas.correct", vm.snapshotGasLastCall("correct"));
        IEAS.Attestation memory attestation = eas.getAttestation(second.easUID);
        assertEq(attestation.refUID, first.easUID);
        assertFalse(_isCurrentEasValid(first.actionId));
        assertTrue(_isCurrentEasValid(second.actionId));
        assertEq(eas.revokeCount(), 1);
    }

    function testT15WrongWalletCorrectionDoesNotMoveSoulboundCredential() public {
        ByUsActionHub.ActionRequest memory original = _request(keccak256("wrong-wallet"), 2, fan);
        ByUsActionHub.CredentialIntent[] memory minted = _stampIntent("wrong-wallet");
        vm.prank(writer);
        ByUsActionHub.ActionResult memory first = hub.recordAndIssue(original, minted);

        ByUsActionHub.ActionRequest memory corrected = original;
        corrected.revision = 2;
        corrected.fan = stranger;
        ByUsActionHub.CredentialIntent[] memory noLinks = new ByUsActionHub.CredentialIntent[](0);
        vm.prank(corrector);
        ByUsActionHub.ActionResult memory second = hub.correct(first.actionId, corrected, noLinks);

        assertEq(stamp.balanceOf(fan, 1), 1);
        assertEq(stamp.balanceOf(stranger, 1), 0);
        assertEq(
            uint8(hub.getAction(first.actionId).status),
            uint8(ByUsActionHub.ActionStatus.INVALIDATED)
        );
        assertEq(
            uint8(hub.getAction(second.actionId).status), uint8(ByUsActionHub.ActionStatus.ACTIVE)
        );
    }

    function testHistoricalCorrectionPreservesOriginAndMigrationBatch() public {
        ByUsActionHub.ActionRequest memory original =
            _historicalRequest(keccak256("historical-correction"), 2);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("historical-correction");
        _registerSingleLeafBatch(original, intents, 1);
        vm.prank(migrator);
        ByUsActionHub.ActionResult memory first =
            hub.importHistorical(original, intents, new bytes32[](0));

        ByUsActionHub.ActionRequest memory corrected = original;
        corrected.revision = 2;
        ByUsActionHub.CredentialIntent[] memory noLinks = new ByUsActionHub.CredentialIntent[](0);
        vm.prank(corrector);
        ByUsActionHub.ActionResult memory second = hub.correct(first.actionId, corrected, noLinks);

        IEAS.Attestation memory attestation = eas.getAttestation(second.easUID);
        (uint8 origin, bytes32 batchId) = _originAndBatch(attestation.data);
        assertEq(origin, uint8(ByUsActionHub.Origin.HISTORICAL));
        assertEq(batchId, original.migrationBatchId);
    }

    function testT16AndT17UpgradePreservesStateAndInitializationLocked() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("upgrade"), 2, fan);
        vm.prank(writer);
        ByUsActionHub.ActionResult memory result =
            hub.recordAndIssue(request, _stampIntent("upgrade"));
        bytes32 recordBefore = keccak256(abi.encode(hub.getAction(result.actionId)));
        bytes32 occurrenceId = hub.computeOccurrenceId(request.sourceOccurrence);
        bytes32 latestBefore = hub.latestActionId(occurrenceId);
        ByUsActionHubV2 v2 = new ByUsActionHubV2();

        vm.prank(stranger);
        vm.expectRevert(ByUsActionHub.AccessDenied.selector);
        hub.upgradeToAndCall(address(v2), "");
        bytes memory upgradeCall =
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(v2), bytes(""));
        bytes32 salt = keccak256("upgrade-v2");
        timelock.schedule(address(hub), 0, upgradeCall, bytes32(0), salt, 2 days);
        vm.expectRevert();
        timelock.execute(address(hub), 0, upgradeCall, bytes32(0), salt);
        vm.warp(block.timestamp + 2 days);
        timelock.execute(address(hub), 0, upgradeCall, bytes32(0), salt);
        assertEq(ByUsActionHubV2(address(hub)).implementationVersion(), 2);
        assertEq(hub.getAction(result.actionId).easUID, result.easUID);
        assertEq(keccak256(abi.encode(hub.getAction(result.actionId))), recordBefore);
        assertEq(hub.latestActionId(occurrenceId), latestBefore);

        ByUsActionHub.ActionRequest memory corrected = request;
        corrected.revision = 2;
        ByUsActionHub.CredentialIntent[] memory links = new ByUsActionHub.CredentialIntent[](1);
        links[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.LINK_EXISTING,
            issuanceKey: keccak256("upgrade"),
            tokenId: 1,
            metadataUri: "ipfs://upgrade"
        });
        vm.prank(corrector);
        hub.correct(result.actionId, corrected, links);
        vm.prank(writer);
        hub.recordAndIssue(
            _request(keccak256("post-upgrade"), 2, fan), _stampIntent("post-upgrade")
        );

        ByUsActionHub.InitializationConfig memory config;
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(config);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        hub.initialize(config);
    }

    function testFreshHubUsesImmediateRegistryAndExistingNfts() public {
        ByUsPublicContextRegistryV2 next = new ByUsPublicContextRegistryV2(admin, address(this));
        ByUsActionHub.InitializationConfig memory config = ByUsActionHub.InitializationConfig({
            admin: admin,
            writer: writer,
            migrator: migrator,
            corrector: corrector,
            pauser: pauser,
            easAddress: address(eas),
            environmentId: keccak256("REPLACEMENT_ENV"),
            schemaUID: SCHEMA_UID,
            passport: address(passport),
            stamp: address(stamp),
            collectible: address(0),
            codec: address(codec),
            contextRegistry: address(next)
        });
        ByUsActionHub replacement = ByUsActionHub(
            address(
                new ERC1967Proxy(
                    address(implementation), abi.encodeCall(ByUsActionHub.initialize, config)
                )
            )
        );
        assertEq(
            replacement.getAssetBinding(1, ByUsActionHub.CredentialKind.PASSPORT), address(passport)
        );
        assertEq(replacement.getAssetBinding(1, ByUsActionHub.CredentialKind.STAMP), address(stamp));
        vm.startPrank(admin);
        passport.grantRole(passport.MINTER_ROLE(), address(replacement));
        stamp.grantRole(stamp.MINTER_ROLE(), address(replacement));
        vm.stopPrank();
        uint256 timestamp = block.timestamp;
        next.registerCreator(CREATOR_ID, "creator-public");
        ByUsActionHub.ActionRequest memory request = _request(keccak256("fresh-immediate"), 10, fan);
        request.campaignId = 0;
        vm.prank(writer);
        ByUsActionHub.ActionResult memory result =
            replacement.recordAndIssue(request, _stampIntent("fresh-immediate"));
        assertEq(block.timestamp, timestamp);
        assertTrue(result.easUID != bytes32(0));
        assertEq(stamp.balanceOf(fan, 1), 1);
        assertTrue(stamp.hasRole(stamp.MINTER_ROLE(), writer));
        assertEq(hub.environmentId(), ENVIRONMENT_ID);
        assertEq(replacement.environmentId(), keccak256("REPLACEMENT_ENV"));
    }

    function testContextUpgradePreservesRecordsAndAllowsImmediateNewCreator() public {
        // Use a context-free existing action: the production transition requires an empty registry.
        ByUsActionHub.ActionRequest memory request =
            _request(keccak256("before-context-upgrade"), 7, fan);
        request.creatorId = 0;
        request.campaignId = 0;
        vm.prank(writer);
        ByUsActionHub.ActionResult memory result =
            hub.recordAndIssue(request, _stampIntent("before-context-upgrade"));
        bytes32 recordBefore = keccak256(abi.encode(hub.getAction(result.actionId)));
        bytes32 occurrence = hub.computeOccurrenceId(request.sourceOccurrence);
        ByUsPublicContextRegistryV2 next = new ByUsPublicContextRegistryV2(admin, address(this));
        ByUsActionHubContextV2 upgraded =
            new ByUsActionHubContextV2(address(contextRegistry), address(next));
        bytes memory migration = abi.encodeCall(upgraded.migrateContextRegistry, ());
        bytes memory data = abi.encodeWithSignature(
            "upgradeToAndCall(address,bytes)", address(upgraded), migration
        );
        bytes32 salt = keccak256("context-upgrade");
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.AccessDenied.selector);
        hub.upgradeToAndCall(address(upgraded), migration);
        timelock.schedule(address(hub), 0, data, 0, salt, 2 days);
        vm.expectRevert();
        timelock.execute(address(hub), 0, data, 0, salt);
        vm.warp(block.timestamp + 2 days);
        timelock.execute(address(hub), 0, data, 0, salt);
        assertEq(ByUsActionHubContextV2(address(hub)).contextRegistry(), address(next));
        assertEq(hub.environmentId(), ENVIRONMENT_ID);
        assertEq(hub.eas(), address(eas));
        assertEq(hub.getSchema(1), SCHEMA_UID);
        assertEq(hub.getAssetBinding(1, ByUsActionHub.CredentialKind.PASSPORT), address(passport));
        assertEq(hub.getAssetBinding(1, ByUsActionHub.CredentialKind.STAMP), address(stamp));
        assertEq(keccak256(abi.encode(hub.getAction(result.actionId))), recordBefore);
        assertEq(hub.latestActionId(occurrence), result.actionId);
        assertEq(stamp.balanceOf(fan, 1), 1);
        vm.expectRevert();
        ByUsActionHubContextV2(address(hub)).migrateContextRegistry();
        vm.expectRevert();
        upgraded.migrateContextRegistry();
        bytes32 newCreator = keccak256("new-immediate-creator");
        next.registerCreator(newCreator, "new-creator");
        request = _request(keccak256("after-context-upgrade"), 10, fan);
        request.creatorId = newCreator;
        request.campaignId = 0;
        vm.prank(writer);
        ByUsActionHub.ActionResult memory afterResult =
            hub.recordAndIssue(request, _stampIntent("after-context-upgrade"));
        request.revision = 2;
        ByUsActionHub.CredentialIntent[] memory links = new ByUsActionHub.CredentialIntent[](1);
        links[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.LINK_EXISTING,
            issuanceKey: keccak256("after-context-upgrade"),
            tokenId: 2,
            metadataUri: "ipfs://after-context-upgrade"
        });
        vm.prank(corrector);
        hub.correct(afterResult.actionId, request, links);
    }

    function testContextUpgradeWrongRegistryRevertsAtomically() public {
        ByUsPublicContextRegistry wrong = new ByUsPublicContextRegistry(admin);
        ByUsPublicContextRegistryV2 next = new ByUsPublicContextRegistryV2(admin, address(this));
        ByUsActionHubContextV2 upgraded = new ByUsActionHubContextV2(address(wrong), address(next));
        bytes memory data = abi.encodeWithSignature(
            "upgradeToAndCall(address,bytes)",
            address(upgraded),
            abi.encodeCall(upgraded.migrateContextRegistry, ())
        );
        timelock.schedule(address(hub), 0, data, 0, 0, 2 days);
        vm.warp(block.timestamp + 2 days);
        bytes32 slot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        bytes32 before = vm.load(address(hub), slot);
        vm.expectRevert(ByUsActionHubContextV2.InvalidRegistryTransition.selector);
        timelock.execute(address(hub), 0, data, 0, 0);
        assertEq(vm.load(address(hub), slot), before);
    }

    function testContextUpgradeRejectsWrongGovernanceAndUnprivilegedMigration() public {
        address[] memory operators = new address[](1);
        operators[0] = address(this);
        TimelockController other = new TimelockController(2 days, operators, operators, address(0));
        ByUsPublicContextRegistryV2 wrong =
            new ByUsPublicContextRegistryV2(address(other), stranger);
        vm.expectRevert(ByUsActionHubContextV2.InvalidRegistryTransition.selector);
        new ByUsActionHubContextV2(address(contextRegistry), address(wrong));
        ByUsPublicContextRegistryV2 next = new ByUsPublicContextRegistryV2(admin, address(this));
        ByUsActionHubContextV2 upgraded =
            new ByUsActionHubContextV2(address(contextRegistry), address(next));
        // Deliberately split the operation to prove a stranger cannot consume the reinitializer.
        vm.prank(admin);
        hub.upgradeToAndCall(address(upgraded), "");
        vm.prank(stranger);
        vm.expectRevert(ByUsActionHub.AccessDenied.selector);
        ByUsActionHubContextV2(address(hub)).migrateContextRegistry();
        vm.prank(admin);
        ByUsActionHubContextV2(address(hub)).migrateContextRegistry();
        assertEq(ByUsActionHubContextV2(address(hub)).contextRegistry(), address(next));
    }

    function testInitializerRequiresReal48HourTimelockAndSeparatedWriter() public {
        ByUsActionHub fresh = new ByUsActionHub();
        ByUsActionHub.InitializationConfig memory config = ByUsActionHub.InitializationConfig({
            admin: stranger,
            writer: writer,
            migrator: migrator,
            corrector: corrector,
            pauser: pauser,
            easAddress: address(eas),
            environmentId: ENVIRONMENT_ID,
            schemaUID: SCHEMA_UID,
            passport: address(passport),
            stamp: address(stamp),
            collectible: address(collectible),
            codec: address(codec),
            contextRegistry: address(contextRegistry)
        });
        vm.expectRevert(ByUsActionHub.InvalidTimelock.selector);
        new ERC1967Proxy(address(fresh), abi.encodeCall(ByUsActionHub.initialize, config));

        config.admin = admin;
        config.writer = migrator;
        vm.expectRevert(ByUsActionHub.InvalidRoleSeparation.selector);
        new ERC1967Proxy(address(fresh), abi.encodeCall(ByUsActionHub.initialize, config));
    }

    function testT18PauseStopsWritesAndOnlyAdminCanUnpause() public {
        vm.prank(pauser);
        hub.pause();
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.Paused.selector);
        hub.recordAndIssue(_request(keccak256("paused"), 2, fan), _stampIntent("paused"));
        vm.prank(pauser);
        vm.expectRevert(ByUsActionHub.AccessDenied.selector);
        hub.unpause();
        vm.prank(admin);
        hub.unpause();
    }

    function testT21RejectsFutureDayAndMissingPublicContext() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("future"), 2, fan);
        request.occurredDay = uint32(block.timestamp / 1 days + 1);
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.InvalidActionContext.selector);
        hub.recordAndIssue(request, _stampIntent("future"));

        request.occurredDay = uint32(block.timestamp / 1 days);
        request.creatorId = bytes32(0);
        vm.prank(writer);
        vm.expectRevert(ByUsActionHub.InvalidActionContext.selector);
        hub.recordAndIssue(request, _stampIntent("future"));
    }

    function testT25MixedHistoricalRequestMintsOnlyMissingCredential() public {
        bytes32 passportKey = keccak256("mixed-passport");
        vm.prank(writer);
        uint256 passportId = passport.mint(fan, passportKey, "ipfs://mixed-passport");
        ByUsActionHub.ActionRequest memory request = _historicalRequest(keccak256("mixed"), 1);
        request.campaignId = bytes32(0);
        ByUsActionHub.CredentialIntent[] memory intents = new ByUsActionHub.CredentialIntent[](2);
        intents[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.PASSPORT,
            mode: ByUsActionHub.IntentMode.LINK_EXISTING,
            issuanceKey: passportKey,
            tokenId: passportId,
            metadataUri: "ipfs://mixed-passport"
        });
        intents[1] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.MINT,
            issuanceKey: keccak256("mixed-stamp"),
            tokenId: 0,
            metadataUri: "ipfs://mixed-stamp"
        });
        _registerSingleLeafBatch(request, intents, 1);
        vm.prank(migrator);
        ByUsActionHub.ActionResult memory result =
            hub.importHistorical(request, intents, new bytes32[](0));
        emit log_named_uint("gas.historical_mixed", vm.snapshotGasLastCall("historical_mixed"));
        assertEq(passport.ownerOf(passportId), fan);
        assertEq(passport.ownerOf(passportId), fan);
        assertEq(stamp.balanceOf(fan, 1), 1);
        assertEq(stamp.balanceOf(fan, 1), 1);
    }

    function testT26MigratorCannotRegisterOrExpandBatch() public {
        vm.prank(migrator);
        vm.expectRevert(ByUsActionHub.AccessDenied.selector);
        hub.registerMigrationBatch(
            keccak256("batch"), keccak256("root"), uint64(block.timestamp + 1 days), 9
        );
    }

    function testT28CredentialCannotMoveToAnotherOccurrence() public {
        ByUsActionHub.ActionRequest memory first = _request(keccak256("one"), 2, fan);
        ByUsActionHub.CredentialIntent[] memory minted = _stampIntent("one");
        vm.prank(writer);
        hub.recordAndIssue(first, minted);

        ByUsActionHub.ActionRequest memory second = _historicalRequest(keccak256("two"), 2);
        ByUsActionHub.CredentialIntent[] memory links = new ByUsActionHub.CredentialIntent[](1);
        links[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.LINK_EXISTING,
            issuanceKey: minted[0].issuanceKey,
            tokenId: 1,
            metadataUri: minted[0].metadataUri
        });
        _registerSingleLeafBatch(second, links, 0);
        vm.prank(migrator);
        vm.expectRevert(ByUsActionHub.CredentialAlreadyLinked.selector);
        hub.importHistorical(second, links, new bytes32[](0));
    }

    function testT29ValidityChecksEASFieldsBeyondExistence() public {
        ByUsActionHub.ActionRequest memory request = _request(keccak256("validity"), 2, fan);
        vm.prank(writer);
        ByUsActionHub.ActionResult memory result =
            hub.recordAndIssue(request, _stampIntent("validity"));
        assertTrue(_isCurrentEasValid(result.actionId));
        eas.forceRecipient(result.easUID, stranger);
        assertFalse(_isCurrentEasValid(result.actionId));
    }

    function _request(bytes32 source, uint16 actionCode, address recipient)
        internal
        view
        returns (ByUsActionHub.ActionRequest memory)
    {
        return ByUsActionHub.ActionRequest({
            sourceOccurrence: source,
            revision: 1,
            actionCode: actionCode,
            schemaVersion: 1,
            policyVersion: 1,
            fan: recipient,
            creatorId: CREATOR_ID,
            campaignId: CAMPAIGN_ID,
            occurredDay: uint32(block.timestamp / 1 days),
            evidenceCommitment: keccak256(abi.encode("private evidence", source)),
            migrationBatchId: bytes32(0),
            bindingVersion: 1
        });
    }

    function _originAndBatch(bytes memory data)
        internal
        pure
        returns (uint8 rawOrigin, bytes32 batchId)
    {
        assembly ("memory-safe") {
            rawOrigin := mload(add(data, 0x160))
            batchId := mload(add(data, 0x1c0))
        }
    }

    function _historicalRequest(bytes32 source, uint16 actionCode)
        internal
        view
        returns (ByUsActionHub.ActionRequest memory request)
    {
        request = _request(source, actionCode, fan);
        request.migrationBatchId = keccak256(abi.encode("batch", source));
    }

    function _stampIntent(string memory key)
        internal
        pure
        returns (ByUsActionHub.CredentialIntent[] memory intents)
    {
        intents = new ByUsActionHub.CredentialIntent[](1);
        intents[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.MINT,
            issuanceKey: keccak256(bytes(key)),
            tokenId: 0,
            metadataUri: string.concat("ipfs://", key)
        });
    }

    function _fanVerifiedIntents(string memory key)
        internal
        pure
        returns (ByUsActionHub.CredentialIntent[] memory intents)
    {
        intents = new ByUsActionHub.CredentialIntent[](2);
        intents[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.PASSPORT,
            mode: ByUsActionHub.IntentMode.MINT,
            issuanceKey: keccak256(abi.encode("passport", key)),
            tokenId: 0,
            metadataUri: string.concat("ipfs://passport/", key)
        });
        intents[1] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.MINT,
            issuanceKey: keccak256(abi.encode("knowledge", key)),
            tokenId: 0,
            metadataUri: string.concat("ipfs://knowledge/", key)
        });
    }

    function _registerSingleLeafBatch(
        ByUsActionHub.ActionRequest memory request,
        ByUsActionHub.CredentialIntent[] memory intents,
        uint32 maxMints
    ) internal {
        bytes32 occurrenceId = hub.computeOccurrenceId(request.sourceOccurrence);
        bytes32 actionId = hub.computeActionId(occurrenceId, request.revision);
        bytes32 requestHash =
            hub.hashRequest(ByUsActionHub.OperationKind.IMPORT_HISTORICAL, request, intents);
        bytes32 leaf = keccak256(
            abi.encode(request.migrationBatchId, ENVIRONMENT_ID, actionId, requestHash)
        );
        vm.prank(admin);
        hub.registerMigrationBatch(
            request.migrationBatchId, leaf, uint64(block.timestamp + 7 days), maxMints
        );
    }

    function _isCurrentEasValid(bytes32 actionId) internal view returns (bool) {
        ByUsActionHub.ActionRecord memory record = hub.getAction(actionId);
        if (
            record.status != ByUsActionHub.ActionStatus.ACTIVE
                || hub.latestActionId(record.occurrenceId) != actionId
        ) return false;
        return codec.isEasValid(
            address(eas),
            ByUsActionCodec.ExpectedAttestation({
                uid: record.easUID,
                schema: record.schemaUID,
                refUID: record.refUID,
                dataHash: record.recordHash,
                recipient: record.fan,
                attester: address(hub)
            })
        );
    }

    function test_deploymentCliStorageReadbackMatchesInitializedProxy() public view {
        uint256 namespace = 0x9b4561162b6d58cdaee430aa4073a2ec544ff4ca21320ef4e942bd0b419f7700;
        bytes32[6] memory roles = [
            bytes32(0),
            keccak256("WRITER_ROLE"),
            keccak256("MIGRATOR_ROLE"),
            keccak256("CORRECTOR_ROLE"),
            keccak256("PAUSER_ROLE"),
            keccak256("UPGRADER_ROLE")
        ];
        address[6] memory accounts =
            [address(timelock), writer, migrator, corrector, pauser, address(timelock)];
        for (uint256 i; i < roles.length; ++i) {
            bytes32 outer = keccak256(abi.encode(roles[i], namespace + 9));
            bytes32 slot = keccak256(abi.encode(accounts[i], outer));
            assertEq(uint256(vm.load(address(hub), slot)), 1);
            bytes32 wrongSlot =
                keccak256(abi.encode(accounts[i], keccak256(abi.encode(roles[i], namespace + 10))));
            assertEq(uint256(vm.load(address(hub), wrongSlot)), 0);
        }
        bytes32 implementationSlot =
            0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        assertEq(
            address(uint160(uint256(vm.load(address(hub), implementationSlot)))),
            address(implementation)
        );
    }
}
