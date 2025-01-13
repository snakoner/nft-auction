// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IAuction {
    error AuctionAlreadyEnded();

    error InsufficientBidValue();

    error CreatorBidForbidden();

    error ArrayLengthMissmatch();

    event LotAdded(
        uint256 indexed id,
        address indexed token,
        uint256 tokenId,
        uint256 startPrice,
        uint64 timeout,
        address indexed creator
    );

    event LotBidded (
        uint256 indexed id,
        address indexed bidder,
        uint256 newPrice
    );

    event LotEnded(
        uint256 indexed id,
        address indexed winner,
        uint256 finalPrice
    );
}