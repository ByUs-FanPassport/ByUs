// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IByUsPublicContextRegistry } from "./interfaces/IByUsPublicContextRegistry.sol";

contract ByUsPublicContextRegistry is IByUsPublicContextRegistry {
    struct CampaignContext {
        bytes32 creatorId;
        uint8 status;
    }

    address public immutable admin;
    mapping(bytes32 creatorId => uint8 status) private _creatorStatuses;
    mapping(bytes32 campaignId => CampaignContext context) private _campaigns;

    error AccessDenied();
    error InvalidContext();
    error AlreadyRegistered();
    error InvalidTimelock();

    event CreatorRegistered(bytes32 indexed creatorId, string publicSlug);
    event CreatorActiveChanged(bytes32 indexed creatorId, bool active);
    event CampaignRegistered(
        bytes32 indexed campaignId, bytes32 indexed creatorId, string publicSlug
    );
    event CampaignActiveChanged(bytes32 indexed campaignId, bool active);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert AccessDenied();
        _;
    }

    constructor(address admin_) {
        if (!_isValidTimelock(admin_)) revert InvalidTimelock();
        admin = admin_;
    }

    function registerCreator(bytes32 creatorId, string calldata publicSlug) external onlyAdmin {
        if (creatorId == bytes32(0) || bytes(publicSlug).length == 0) revert InvalidContext();
        if (_creatorStatuses[creatorId] != 0) revert AlreadyRegistered();
        _creatorStatuses[creatorId] = 1;
        emit CreatorRegistered(creatorId, publicSlug);
    }

    function setCreatorActive(bytes32 creatorId, bool active) external onlyAdmin {
        if (_creatorStatuses[creatorId] == 0) revert InvalidContext();
        _creatorStatuses[creatorId] = active ? 1 : 2;
        emit CreatorActiveChanged(creatorId, active);
    }

    function registerCampaign(bytes32 campaignId, bytes32 creatorId, string calldata publicSlug)
        external
        onlyAdmin
    {
        if (
            campaignId == bytes32(0) || bytes(publicSlug).length == 0
                || _creatorStatuses[creatorId] != 1
        ) revert InvalidContext();
        if (_campaigns[campaignId].status != 0) revert AlreadyRegistered();
        _campaigns[campaignId] = CampaignContext(creatorId, 1);
        emit CampaignRegistered(campaignId, creatorId, publicSlug);
    }

    function setCampaignActive(bytes32 campaignId, bool active) external onlyAdmin {
        CampaignContext storage context = _campaigns[campaignId];
        if (context.status == 0) revert InvalidContext();
        context.status = active ? 1 : 2;
        emit CampaignActiveChanged(campaignId, active);
    }

    function isValidContext(bytes32 creatorId, bytes32 campaignId) external view returns (bool) {
        if (creatorId == bytes32(0)) return campaignId == bytes32(0);
        if (_creatorStatuses[creatorId] != 1) return false;
        if (campaignId == bytes32(0)) return true;
        CampaignContext storage context = _campaigns[campaignId];
        return context.status == 1 && context.creatorId == creatorId;
    }

    function _isValidTimelock(address account) private view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory data) = account.staticcall(abi.encodeWithSignature("getMinDelay()"));
        return ok && data.length >= 32 && abi.decode(data, (uint256)) >= 2 days;
    }
}
