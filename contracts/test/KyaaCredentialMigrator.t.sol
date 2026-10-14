// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ByUsPassport } from "../src/ByUsPassport.sol";
import { ByUsStamp } from "../src/ByUsStamp.sol";
import { ByUsActionHub } from "../src/ByUsActionHub.sol";
import { KyaaPassport } from "../src/KyaaPassport.sol";
import { KyaaStamp } from "../src/KyaaStamp.sol";
import { KyaaCredentialMigrator } from "../src/KyaaCredentialMigrator.sol";
import { IEAS } from "../src/interfaces/IEAS.sol";
import { ERC721Holder } from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

contract ReplacementCallbackReceiver is ERC721Holder {
    address target;
    bytes callData;
    bool public reentered;
    bytes4 public failure;

    function configure(address target_, bytes memory data) external {
        target = target_;
        callData = data;
    }

    function onERC721Received(address, address, uint256, bytes memory)
        public
        override
        returns (bytes4)
    {
        if (target != address(0)) {
            bytes memory result;
            (reentered, result) = target.call(callData);
            failure = bytes4(result);
        }
        return this.onERC721Received.selector;
    }
}

contract KyaaCredentialMigratorTest is Test {
    address operator = makeAddr("operator");
    address fan = makeAddr("fan");
    address hub = makeAddr("hub");
    ByUsPassport oldPassport;
    ByUsStamp oldStamp;
    KyaaPassport newPassport;
    KyaaStamp newStamp;
    KyaaCredentialMigrator migrator;
    bytes32 batchId = keccak256("batch");

    function setUp() public {
        oldPassport = new ByUsPassport(address(this), address(this));
        oldStamp = new ByUsStamp(address(this), address(this));
        newPassport = new KyaaPassport(address(this), address(this));
        newStamp = new KyaaStamp(address(this), address(this));
        vm.mockCall(
            hub,
            abi.encodeCall(ByUsActionHub.environmentId, ()),
            abi.encode(keccak256("environment"))
        );
        migrator = new KyaaCredentialMigrator(
            address(this),
            operator,
            hub,
            hub,
            address(oldPassport),
            address(oldStamp),
            address(newPassport),
            address(newStamp)
        );
        newPassport.grantRole(newPassport.MINTER_ROLE(), address(migrator));
        newStamp.grantRole(newStamp.MINTER_ROLE(), address(migrator));
    }

    function item(uint8 kind) internal returns (KyaaCredentialMigrator.Item memory result) {
        bytes32 key = keccak256(abi.encode(kind));
        uint256 token = kind == 0
            ? oldPassport.mint(fan, key, "ipfs://old")
            : oldStamp.mint(fan, key, "ipfs://old");
        result = KyaaCredentialMigrator.Item(
            batchId,
            kind,
            token,
            key,
            fan,
            keccak256("ipfs://old"),
            keccak256("ipfs://new"),
            address(0),
            bytes32(0)
        );
    }

    function register(KyaaCredentialMigrator.Item memory value, uint32 maxMints) internal {
        migrator.registerBatch(
            value.batchId,
            migrator.leafHash(value),
            keccak256("manifest"),
            1,
            maxMints,
            uint64(block.timestamp + 1 days)
        );
    }

    function migrate(KyaaCredentialMigrator.Item memory value) internal returns (uint256) {
        vm.prank(operator);
        return migrator.migrate(
            value, "ipfs://new", new bytes32[](0), new ByUsActionHub.CredentialRef[](0)
        );
    }

    function testPassportPreservesOriginalAndIsIdempotent() public {
        KyaaCredentialMigrator.Item memory value = item(0);
        register(value, 1);
        uint256 target = migrate(value);
        assertEq(target, migrate(value));
        assertEq(oldPassport.ownerOf(value.oldTokenId), fan);
        assertEq(oldPassport.tokenURI(value.oldTokenId), "ipfs://old");
        assertEq(newPassport.ownerOf(target), fan);
        assertEq(newPassport.tokenURI(target), "ipfs://new");
        assertEq(newPassport.tokenByPassportId(value.issuanceKey), target);
    }

    function testStampAndExistingExactTarget() public {
        KyaaCredentialMigrator.Item memory value = item(1);
        uint256 target = newStamp.mint(fan, value.issuanceKey, "ipfs://new");
        register(value, 0);
        assertEq(migrate(value), target);
        assertEq(newStamp.totalSupply(target), 1);
        assertEq(oldStamp.balanceOf(fan, value.oldTokenId), 1);
    }

    function testWrongOwnerOrUriTargetCannotBeLinked() public {
        KyaaCredentialMigrator.Item memory value = item(1);
        newStamp.mint(fan, value.issuanceKey, "ipfs://wrong");
        register(value, 1);
        vm.expectRevert(KyaaCredentialMigrator.AssetMismatch.selector);
        migrate(value);
    }

    function testPermissionsProofAndPause() public {
        KyaaCredentialMigrator.Item memory value = item(0);
        register(value, 1);
        vm.expectRevert(KyaaCredentialMigrator.Unauthorized.selector);
        migrator.migrate(
            value, "ipfs://new", new bytes32[](0), new ByUsActionHub.CredentialRef[](0)
        );
        value.recipient = operator;
        vm.expectRevert(KyaaCredentialMigrator.InvalidProof.selector);
        migrate(value);
        value.recipient = fan;
        vm.prank(operator);
        migrator.pause();
        vm.expectRevert(KyaaCredentialMigrator.BatchUnavailable.selector);
        migrate(value);
        vm.prank(operator);
        vm.expectRevert(KyaaCredentialMigrator.Unauthorized.selector);
        migrator.unpause();
        migrator.unpause();
        assertGt(migrate(value), 0);
    }

    function testExpiredAndMintLimit() public {
        KyaaCredentialMigrator.Item memory value = item(0);
        register(value, 0);
        vm.expectRevert(KyaaCredentialMigrator.BatchLimit.selector);
        migrate(value);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(KyaaCredentialMigrator.BatchUnavailable.selector);
        migrate(value);
    }

    function testOriginalCannotBeMigratedInAnotherBatch() public {
        KyaaCredentialMigrator.Item memory value = item(0);
        register(value, 1);
        migrate(value);
        value.batchId = keccak256("second batch");
        register(value, 1);
        vm.expectRevert(KyaaCredentialMigrator.AlreadyMapped.selector);
        migrate(value);
    }

    function testBoundedBatchAndTimelockOnlyRegistration() public {
        KyaaCredentialMigrator.Item memory value = item(0);
        bytes32 leaf = migrator.leafHash(value);
        vm.prank(operator);
        vm.expectRevert(KyaaCredentialMigrator.Unauthorized.selector);
        migrator.registerBatch(
            batchId, leaf, keccak256("manifest"), 1, 1, uint64(block.timestamp + 1 days)
        );
        register(value, 1);
        vm.expectRevert(KyaaCredentialMigrator.InvalidBatch.selector);
        migrator.registerBatch(
            batchId, leaf, keccak256("manifest"), 1, 1, uint64(block.timestamp + 1 days)
        );
    }

    function nativeItem()
        internal
        returns (
            KyaaCredentialMigrator.Item memory value,
            ByUsActionHub.CredentialRef[] memory refs,
            ByUsActionHub.ActionRecord memory record,
            IEAS.Attestation memory attestation
        )
    {
        value = item(1);
        value.sourceActionId = keccak256("action");
        value.sourceHub = hub;
        refs = new ByUsActionHub.CredentialRef[](1);
        refs[0] = ByUsActionHub.CredentialRef(
            address(oldStamp),
            value.oldTokenId,
            ByUsActionHub.CredentialKind.STAMP,
            value.issuanceKey,
            ByUsActionHub.LinkOrigin.MINTED_NOW
        );
        record.actionId = value.sourceActionId;
        record.occurrenceId = keccak256("occurrence");
        record.easUID = keccak256("eas uid");
        record.schemaUID = keccak256("schema");
        record.fan = fan;
        record.status = ByUsActionHub.ActionStatus.ACTIVE;
        bytes memory data = abi.encode(
            record.occurrenceId,
            record.actionId,
            uint32(1),
            uint16(1),
            uint16(1),
            uint32(1),
            keccak256("environment"),
            bytes32(0),
            bytes32(0),
            uint32(1),
            uint8(0),
            bytes32(0),
            keccak256(abi.encode(refs)),
            bytes32(0)
        );
        record.recordHash = keccak256(data);
        attestation = IEAS.Attestation(
            record.easUID,
            record.schemaUID,
            uint64(block.timestamp),
            0,
            0,
            bytes32(0),
            fan,
            hub,
            true,
            data
        );
        address eas = makeAddr("eas");
        vm.mockCall(hub, abi.encodeCall(ByUsActionHub.eas, ()), abi.encode(eas));
        vm.mockCall(
            hub, abi.encodeCall(ByUsActionHub.getAction, (value.sourceActionId)), abi.encode(record)
        );
        vm.mockCall(
            hub,
            abi.encodeCall(ByUsActionHub.latestActionId, (record.occurrenceId)),
            abi.encode(value.sourceActionId)
        );
        vm.mockCall(
            eas, abi.encodeCall(IEAS.getAttestation, (record.easUID)), abi.encode(attestation)
        );
        vm.mockCall(eas, abi.encodeCall(IEAS.isAttestationValid, (record.easUID)), abi.encode(true));
        register(value, 1);
    }

    function testCurrentAttestedSourceCanMigrateWithoutChangingAction() public {
        (
            KyaaCredentialMigrator.Item memory value,
            ByUsActionHub.CredentialRef[] memory refs,
            ByUsActionHub.ActionRecord memory record,
        ) = nativeItem();
        vm.prank(operator);
        uint256 tokenId = migrator.migrate(value, "ipfs://new", new bytes32[](0), refs);
        assertEq(newStamp.balanceOf(fan, tokenId), 1);
        assertEq(ByUsActionHub(hub).getAction(value.sourceActionId).easUID, record.easUID);
    }

    function testRevokedOrCorrectedSourceIsRejected() public {
        (
            KyaaCredentialMigrator.Item memory value,
            ByUsActionHub.CredentialRef[] memory refs,
            ByUsActionHub.ActionRecord memory record,
            IEAS.Attestation memory attestation
        ) = nativeItem();
        attestation.revocationTime = uint64(block.timestamp);
        vm.mockCall(
            makeAddr("eas"),
            abi.encodeCall(IEAS.getAttestation, (record.easUID)),
            abi.encode(attestation)
        );
        vm.prank(operator);
        vm.expectRevert(KyaaCredentialMigrator.InvalidSourceAction.selector);
        migrator.migrate(value, "ipfs://new", new bytes32[](0), refs);
        attestation.revocationTime = 0;
        vm.mockCall(
            makeAddr("eas"),
            abi.encodeCall(IEAS.getAttestation, (record.easUID)),
            abi.encode(attestation)
        );
        vm.mockCall(
            hub,
            abi.encodeCall(ByUsActionHub.latestActionId, (record.occurrenceId)),
            abi.encode(keccak256("corrected"))
        );
        vm.prank(operator);
        vm.expectRevert(KyaaCredentialMigrator.InvalidSourceAction.selector);
        migrator.migrate(value, "ipfs://new", new bytes32[](0), refs);
    }

    function testForgedCredentialRefsAreRejected() public {
        (KyaaCredentialMigrator.Item memory value, ByUsActionHub.CredentialRef[] memory refs,,) =
            nativeItem();
        refs[0].tokenId++;
        vm.prank(operator);
        vm.expectRevert(KyaaCredentialMigrator.InvalidSourceAction.selector);
        migrator.migrate(value, "ipfs://new", new bytes32[](0), refs);
    }

    function testSourceOwnerAndMetadataCannotBeRedirectedByRoot() public {
        KyaaCredentialMigrator.Item memory value = item(0);
        value.recipient = operator;
        register(value, 1);
        vm.expectRevert(KyaaCredentialMigrator.AssetMismatch.selector);
        migrate(value);
    }

    function testSafeMintCallbackCannotReenterAndOuterReplacementCompletes() public {
        ReplacementCallbackReceiver receiver = new ReplacementCallbackReceiver();
        fan = address(receiver);
        KyaaCredentialMigrator.Item memory value = item(0);
        register(value, 1);
        receiver.configure(
            address(migrator),
            abi.encodeCall(
                migrator.migrate,
                (value, "ipfs://new", new bytes32[](0), new ByUsActionHub.CredentialRef[](0))
            )
        );
        uint256 token = migrate(value);
        assertFalse(receiver.reentered());
        assertEq(receiver.failure(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(newPassport.ownerOf(token), fan);
        assertEq(oldPassport.ownerOf(value.oldTokenId), fan);
        (,,,,, uint32 used, uint32 minted,) = migrator.batches(batchId);
        assertEq(used, 1);
        assertEq(minted, 1);
    }
}
