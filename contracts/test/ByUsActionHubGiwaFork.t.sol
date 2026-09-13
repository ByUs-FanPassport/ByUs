// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Run with:
// RUN_GIWA_FORK_INTEGRATION=1 forge test --threads 1 \
//   --match-path test/ByUsActionHubGiwaFork.t.sol -vv

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { ByUsActionHub } from "../src/ByUsActionHub.sol";
import { ByUsActionCodec } from "../src/ByUsActionCodec.sol";
import { ByUsPublicContextRegistry } from "../src/ByUsPublicContextRegistry.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { ByUsStamp } from "../src/ByUsStamp.sol";
import { ByUsCollectible } from "../src/ByUsCollectible.sol";
import { IEAS } from "../src/interfaces/IEAS.sol";

interface IGiwaVersioned {
    function version() external view returns (string memory);
}

interface IGiwaSchemaRegistry is IGiwaVersioned {
    struct SchemaRecord {
        bytes32 uid;
        address resolver;
        bool revocable;
        string schema;
    }

    function register(string calldata schema, address resolver, bool revocable)
        external
        returns (bytes32);
    function getSchema(bytes32 uid) external view returns (SchemaRecord memory);
}

contract ByUsActionHubGiwaForkTest is Test {
    uint256 internal constant GIWA_FORK_BLOCK = 35_949_726;
    address internal constant EAS_ADDRESS = 0x4200000000000000000000000000000000000021;
    address internal constant SCHEMA_REGISTRY = 0x4200000000000000000000000000000000000020;
    string internal constant ACTION_SCHEMA =
        "bytes32 occurrenceId,bytes32 actionId,uint32 revision,uint16 actionCode,uint16 schemaVersion,uint32 policyVersion,bytes32 environmentId,bytes32 creatorId,bytes32 campaignId,uint32 occurredDay,uint8 origin,bytes32 evidenceCommitment,bytes32 credentialRefsHash,bytes32 migrationBatchId";

    bytes32 internal constant ENVIRONMENT_ID = keccak256("GIWA_SEPOLIA_FORK_TEST");
    bytes32 internal constant CREATOR_ID = keccak256("giwa-fork-creator");
    bytes32 internal constant CAMPAIGN_ID = keccak256("giwa-fork-campaign");

    address internal writer = makeAddr("giwa-fork-writer");
    address internal migrator = makeAddr("giwa-fork-migrator");
    address internal corrector = makeAddr("giwa-fork-corrector");
    address internal pauser = makeAddr("giwa-fork-pauser");
    address internal fan = makeAddr("giwa-fork-fan");

    IEAS internal eas = IEAS(EAS_ADDRESS);
    IGiwaSchemaRegistry internal schemaRegistry = IGiwaSchemaRegistry(SCHEMA_REGISTRY);
    bytes32 internal schemaUID;
    address internal admin;
    TimelockController internal timelock;
    ByUsActionHub internal hub;
    ByUsActionCodec internal codec;
    ByUsPublicContextRegistry internal contextRegistry;
    ByUsPassport internal passport;
    ByUsStamp internal stamp;
    ByUsCollectible internal collectible;

    struct DecodedAction {
        bytes32 occurrenceId;
        bytes32 actionId;
        uint32 revision;
        uint16 actionCode;
        uint16 schemaVersion;
        uint32 policyVersion;
        bytes32 environmentId;
        bytes32 creatorId;
        bytes32 campaignId;
        uint32 occurredDay;
        uint8 origin;
        bytes32 evidenceCommitment;
        bytes32 credentialRefsHash;
        bytes32 migrationBatchId;
    }

    function setUp() public {
        if (!vm.envOr("RUN_GIWA_FORK_INTEGRATION", false)) {
            vm.skip(true, "set RUN_GIWA_FORK_INTEGRATION=1 to run GIWA fork tests");
            return;
        }
        vm.createSelectFork("https://sepolia-rpc.giwa.io", GIWA_FORK_BLOCK);
        require(block.chainid == 91_342, "NOT_GIWA_SEPOLIA");
        schemaUID = schemaRegistry.register(ACTION_SCHEMA, address(0), true);

        address[] memory proposers = new address[](1);
        proposers[0] = address(this);
        address[] memory executors = new address[](1);
        executors[0] = address(this);
        timelock = new TimelockController(2 days, proposers, executors, address(0));
        admin = address(timelock);

        passport = new ByUsPassport(admin, writer);
        stamp = new ByUsStamp(admin, writer);
        collectible = new ByUsCollectible(admin, writer);
        contextRegistry = new ByUsPublicContextRegistry(admin);
        codec = new ByUsActionCodec();
        ByUsActionHub implementation = new ByUsActionHub();
        ByUsActionHub.InitializationConfig memory config = ByUsActionHub.InitializationConfig({
            admin: admin,
            writer: writer,
            migrator: migrator,
            corrector: corrector,
            pauser: pauser,
            easAddress: EAS_ADDRESS,
            environmentId: ENVIRONMENT_ID,
            schemaUID: schemaUID,
            passport: address(passport),
            stamp: address(stamp),
            collectible: address(collectible),
            codec: address(codec),
            contextRegistry: address(contextRegistry)
        });
        hub = ByUsActionHub(
            address(
                new ERC1967Proxy(
                    address(implementation), abi.encodeCall(ByUsActionHub.initialize, config)
                )
            )
        );

        vm.startPrank(admin);
        contextRegistry.registerCreator(CREATOR_ID, "giwa-fork-creator");
        contextRegistry.registerCampaign(CAMPAIGN_ID, CREATOR_ID, "giwa-fork-campaign");
        passport.grantRole(passport.MINTER_ROLE(), address(hub));
        stamp.grantRole(stamp.MINTER_ROLE(), address(hub));
        collectible.grantRole(collectible.MINTER_ROLE(), address(hub));
        hub.registerRecordOnlyPolicy(7, 2);
        vm.stopPrank();
    }

    function testLiveAbiVersionsSchemaAndPublicContext() public view {
        assertEq(IGiwaVersioned(EAS_ADDRESS).version(), "1.4.1-beta.3");
        assertEq(schemaRegistry.version(), "1.3.1-beta.2");
        IGiwaSchemaRegistry.SchemaRecord memory record = schemaRegistry.getSchema(schemaUID);
        assertEq(record.uid, schemaUID);
        assertEq(record.resolver, address(0));
        assertTrue(record.revocable);
        assertEq(record.schema, ACTION_SCHEMA);
        assertTrue(contextRegistry.isValidContext(CREATOR_ID, CAMPAIGN_ID));
        assertEq(hub.eas(), EAS_ADDRESS);
        assertEq(hub.getSchema(1), schemaUID);
    }

    function testRealEasRecordOnlySingleAndTwoCredentialPaths() public {
        ByUsActionHub.ActionRequest memory recordOnlyRequest = _recordOnlyRequest("record-only");
        vm.prank(writer);
        ByUsActionHub.ActionResult memory recordOnly = hub.recordOnly(recordOnlyRequest);
        emit log_named_uint("fork_call_gas.record_only", vm.snapshotGasLastCall("record_only"));
        _assertAttestation(recordOnly, recordOnlyRequest, bytes32(0), ByUsActionHub.Origin.NATIVE);
        assertEq(passport.balanceOf(fan), 0);
        assertEq(stamp.balanceOf(fan, 1), 0);

        ByUsActionHub.ActionRequest memory singleRequest = _request("single-nft", 2);
        ByUsActionHub.CredentialIntent[] memory singleIntent = _stampIntent("single-nft");
        vm.prank(writer);
        ByUsActionHub.ActionResult memory single = hub.recordAndIssue(singleRequest, singleIntent);
        emit log_named_uint("fork_call_gas.single_nft", vm.snapshotGasLastCall("single_nft"));
        _assertAttestation(single, singleRequest, bytes32(0), ByUsActionHub.Origin.NATIVE);
        assertEq(stamp.balanceOf(fan, 1), 1);

        ByUsActionHub.ActionRequest memory twoRequest = _request("two-nft", 1);
        twoRequest.campaignId = bytes32(0);
        ByUsActionHub.CredentialIntent[] memory twoIntents = _fanVerifiedIntents("two-nft");
        vm.prank(writer);
        ByUsActionHub.ActionResult memory two = hub.recordAndIssue(twoRequest, twoIntents);
        emit log_named_uint("fork_call_gas.two_nft", vm.snapshotGasLastCall("two_nft"));
        _assertAttestation(two, twoRequest, bytes32(0), ByUsActionHub.Origin.NATIVE);
        assertEq(passport.ownerOf(1), fan);
        assertEq(stamp.balanceOf(fan, 2), 1);
    }

    function testRealEasFailureRollsBackCredentialAndHubState() public {
        ByUsStamp isolatedStamp = new ByUsStamp(admin, writer);
        ByUsPassport isolatedPassport = new ByUsPassport(admin, writer);
        ByUsCollectible isolatedCollectible = new ByUsCollectible(admin, writer);
        ByUsActionHub invalidHub = _deployHub(
            keccak256("unregistered-schema"), isolatedPassport, isolatedStamp, isolatedCollectible
        );
        vm.startPrank(admin);
        isolatedPassport.grantRole(isolatedPassport.MINTER_ROLE(), address(invalidHub));
        isolatedStamp.grantRole(isolatedStamp.MINTER_ROLE(), address(invalidHub));
        isolatedCollectible.grantRole(isolatedCollectible.MINTER_ROLE(), address(invalidHub));
        vm.stopPrank();

        ByUsActionHub.ActionRequest memory request = _request("real-eas-rollback", 2);
        ByUsActionHub.CredentialIntent[] memory intents = _stampIntent("real-eas-rollback");
        vm.prank(writer);
        vm.expectRevert();
        invalidHub.recordAndIssue(request, intents);
        assertEq(isolatedStamp.tokenByIssuanceId(intents[0].issuanceKey), 0);
        bytes32 occurrenceId = invalidHub.computeOccurrenceId(request.sourceOccurrence);
        assertEq(invalidHub.latestActionId(occurrenceId), bytes32(0));
    }

    function testRealEasInvalidateAndCorrectRevokesAndReferencesPrevious() public {
        ByUsActionHub.ActionRequest memory original = _request("invalidate-correct", 2);
        ByUsActionHub.CredentialIntent[] memory minted = _stampIntent("invalidate-correct");
        vm.prank(writer);
        ByUsActionHub.ActionResult memory first = hub.recordAndIssue(original, minted);

        vm.prank(corrector);
        assertTrue(hub.invalidate(first.actionId, 7));
        IEAS.Attestation memory revoked = eas.getAttestation(first.easUID);
        assertGt(revoked.revocationTime, 0);
        ByUsActionHub.ActionRecord memory firstRecord = hub.getAction(first.actionId);
        assertFalse(
            codec.isEasValid(
                EAS_ADDRESS,
                ByUsActionCodec.ExpectedAttestation({
                    uid: first.easUID,
                    schema: schemaUID,
                    refUID: bytes32(0),
                    dataHash: firstRecord.recordHash,
                    recipient: original.fan,
                    attester: address(hub)
                })
            )
        );

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
        emit log_named_uint("fork_call_gas.correct", vm.snapshotGasLastCall("correct"));
        _assertAttestation(second, corrected, first.easUID, ByUsActionHub.Origin.NATIVE);
        assertEq(eas.getAttestation(second.easUID).refUID, first.easUID);
        assertEq(stamp.balanceOf(fan, 1), 1);
    }

    function testRealEasHistoricalMixedAndH3RecordOnlyCorrection() public {
        bytes32 passportKey = keccak256("historical-existing-passport");
        vm.prank(writer);
        uint256 passportId = passport.mint(fan, passportKey, "ipfs://historical-passport");
        ByUsActionHub.ActionRequest memory mixed = _historicalRequest("historical-mixed", 1, 1);
        mixed.campaignId = bytes32(0);
        ByUsActionHub.CredentialIntent[] memory mixedIntents =
            new ByUsActionHub.CredentialIntent[](2);
        mixedIntents[0] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.PASSPORT,
            mode: ByUsActionHub.IntentMode.LINK_EXISTING,
            issuanceKey: passportKey,
            tokenId: passportId,
            metadataUri: "ipfs://historical-passport"
        });
        mixedIntents[1] = ByUsActionHub.CredentialIntent({
            kind: ByUsActionHub.CredentialKind.STAMP,
            mode: ByUsActionHub.IntentMode.MINT,
            issuanceKey: keccak256("historical-missing-stamp"),
            tokenId: 0,
            metadataUri: "ipfs://historical-stamp"
        });
        _registerSingleLeafBatch(mixed, mixedIntents, 1);
        vm.prank(migrator);
        ByUsActionHub.ActionResult memory mixedResult =
            hub.importHistorical(mixed, mixedIntents, new bytes32[](0));
        emit log_named_uint(
            "fork_call_gas.historical_mixed", vm.snapshotGasLastCall("historical_mixed")
        );
        _assertAttestation(mixedResult, mixed, bytes32(0), ByUsActionHub.Origin.HISTORICAL);
        assertEq(passport.ownerOf(passportId), fan);
        assertEq(stamp.balanceOf(fan, 1), 1);

        ByUsActionHub.ActionRequest memory h3 = _historicalRequest("historical-h3", 7, 2);
        h3.creatorId = bytes32(0);
        h3.campaignId = bytes32(0);
        ByUsActionHub.CredentialIntent[] memory noCredentials =
            new ByUsActionHub.CredentialIntent[](0);
        _registerSingleLeafBatch(h3, noCredentials, 0);
        vm.prank(migrator);
        ByUsActionHub.ActionResult memory h3First =
            hub.importHistorical(h3, noCredentials, new bytes32[](0));
        emit log_named_uint("fork_call_gas.h3_record_only", vm.snapshotGasLastCall("h3"));
        _assertAttestation(h3First, h3, bytes32(0), ByUsActionHub.Origin.HISTORICAL);

        ByUsActionHub.ActionRequest memory h3Correction = h3;
        h3Correction.revision = 2;
        vm.prank(corrector);
        ByUsActionHub.ActionResult memory h3Second =
            hub.correct(h3First.actionId, h3Correction, noCredentials);
        emit log_named_uint("fork_call_gas.h3_correct", vm.snapshotGasLastCall("h3_correct"));
        _assertAttestation(h3Second, h3Correction, h3First.easUID, ByUsActionHub.Origin.HISTORICAL);
        assertGt(eas.getAttestation(h3First.easUID).revocationTime, 0);
        assertEq(
            uint8(hub.getAction(h3Second.actionId).origin), uint8(ByUsActionHub.Origin.HISTORICAL)
        );
        assertEq(hub.getAction(h3Second.actionId).migrationBatchId, h3.migrationBatchId);
        assertEq(hub.getAction(h3Second.actionId).policyVersion, 2);
    }

    function _deployHub(
        bytes32 targetSchemaUID,
        ByUsPassport targetPassport,
        ByUsStamp targetStamp,
        ByUsCollectible targetCollectible
    ) internal returns (ByUsActionHub deployed) {
        ByUsActionHub implementation = new ByUsActionHub();
        ByUsActionHub.InitializationConfig memory config = ByUsActionHub.InitializationConfig({
            admin: admin,
            writer: writer,
            migrator: migrator,
            corrector: corrector,
            pauser: pauser,
            easAddress: EAS_ADDRESS,
            environmentId: ENVIRONMENT_ID,
            schemaUID: targetSchemaUID,
            passport: address(targetPassport),
            stamp: address(targetStamp),
            collectible: address(targetCollectible),
            codec: address(codec),
            contextRegistry: address(contextRegistry)
        });
        deployed = ByUsActionHub(
            address(
                new ERC1967Proxy(
                    address(implementation), abi.encodeCall(ByUsActionHub.initialize, config)
                )
            )
        );
    }

    function _request(string memory source, uint16 actionCode)
        internal
        view
        returns (ByUsActionHub.ActionRequest memory)
    {
        bytes32 sourceOccurrence = keccak256(bytes(source));
        return ByUsActionHub.ActionRequest({
            sourceOccurrence: sourceOccurrence,
            revision: 1,
            actionCode: actionCode,
            schemaVersion: 1,
            policyVersion: 1,
            fan: fan,
            creatorId: CREATOR_ID,
            campaignId: CAMPAIGN_ID,
            occurredDay: uint32(block.timestamp / 1 days),
            evidenceCommitment: keccak256(abi.encode("giwa fork evidence", sourceOccurrence)),
            migrationBatchId: bytes32(0),
            bindingVersion: 1
        });
    }

    function _recordOnlyRequest(string memory source)
        internal
        view
        returns (ByUsActionHub.ActionRequest memory request)
    {
        request = _request(source, 7);
        request.policyVersion = 2;
        request.creatorId = bytes32(0);
        request.campaignId = bytes32(0);
    }

    function _historicalRequest(string memory source, uint16 actionCode, uint32 policyVersion)
        internal
        view
        returns (ByUsActionHub.ActionRequest memory request)
    {
        request = _request(source, actionCode);
        request.policyVersion = policyVersion;
        request.migrationBatchId = keccak256(abi.encode("giwa-fork-batch", source));
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

    function _assertAttestation(
        ByUsActionHub.ActionResult memory result,
        ByUsActionHub.ActionRequest memory request,
        bytes32 expectedRefUID,
        ByUsActionHub.Origin expectedOrigin
    ) internal view {
        ByUsActionHub.ActionRecord memory action = hub.getAction(result.actionId);
        IEAS.Attestation memory attestation = eas.getAttestation(result.easUID);
        assertEq(attestation.uid, result.easUID);
        assertEq(attestation.schema, schemaUID);
        assertEq(attestation.recipient, request.fan);
        assertEq(attestation.attester, address(hub));
        assertEq(attestation.expirationTime, 0);
        assertEq(attestation.revocationTime, 0);
        assertEq(attestation.refUID, expectedRefUID);
        assertTrue(attestation.revocable);
        assertTrue(eas.isAttestationValid(result.easUID));
        assertEq(keccak256(attestation.data), result.recordHash);
        assertEq(action.recordHash, result.recordHash);

        DecodedAction memory decoded = abi.decode(attestation.data, (DecodedAction));
        assertEq(decoded.occurrenceId, action.occurrenceId);
        assertEq(decoded.actionId, result.actionId);
        assertEq(decoded.revision, request.revision);
        assertEq(decoded.actionCode, request.actionCode);
        assertEq(decoded.schemaVersion, request.schemaVersion);
        assertEq(decoded.policyVersion, request.policyVersion);
        assertEq(decoded.environmentId, ENVIRONMENT_ID);
        assertEq(decoded.creatorId, request.creatorId);
        assertEq(decoded.campaignId, request.campaignId);
        assertEq(decoded.occurredDay, request.occurredDay);
        assertEq(decoded.origin, uint8(expectedOrigin));
        assertEq(decoded.evidenceCommitment, request.evidenceCommitment);
        assertEq(decoded.migrationBatchId, request.migrationBatchId);
    }
}
