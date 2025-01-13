// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IMarketplaceERC721Common } from "./IMarketplaceERC721Common.sol";

interface IAuctionERC721 is IMarketplaceERC721Common {
    error AuctionERC721AuctionAlreadyEnded();

    error AuctionERC721InsufficientBidValue();

    event LotAdded(
        uint256 indexed id,
        address indexed item,
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