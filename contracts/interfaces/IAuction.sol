// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IAuction {
    error AuctionAlreadyEnded();

    error InsufficientBidValue();

    error CreatorBidForbidden();

    event LotAdded(
        uint256 indexed id,
        address indexed token,
        uint256 tokenId,
        uint256 startPrice,
        uint256 minBidStep,
        uint64 timeout,
        uint64 extensionTime,
        address indexed creator
    );

    event BidPlaced (
        uint256 indexed id,
        address indexed bidder,
        uint256 newPrice
    );

    event AuctionCompleted(
        uint256 indexed id,
        address indexed winner,
        uint256 finalPrice
    );

    event TimeoutExtended(
        uint256 indexed id,
        uint64 newTimeout
    );

    event MinDurationUpdated(
        uint64 oldMinDuration,
        uint64 newMinDuration
    );

    event DeadlineForExtensionTimeUpdated(
        uint64 oldTime,
        uint64 newTime
    );
}