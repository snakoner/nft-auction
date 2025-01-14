// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Auction} from "../Auction.sol";

contract TestAuction is Auction {
    constructor(
        string memory name,
        uint96 _fee,
        uint64 _minDuration,
        uint64 _deadlineForExtensionTime
    ) Auction(name, _fee, _minDuration, _deadlineForExtensionTime) {}

    function _feeDenominator() internal pure override returns (uint96) {
        return 1000;
    }
}