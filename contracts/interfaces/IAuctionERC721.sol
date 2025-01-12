// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract IAuctionERC721 {
    error AuctionERC721OwnershipError();

    error AuctionERC721AllowanceError();

    error AuctionERC721NoERC721InterfaceSupport();

    error AuctionERC721InvalidInputData();

    error AuctionERC721LotNotExist();

    error AuctionERC721AuctionAlreadyEnded();

    error AuctionERC721InsufficientBidValue();

    error AuctionERC721TransactionFailed();

    error AuctionERC721UnexpectedState(bytes32 expectedState);

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

    event TokenReceived(
        address operator,
        address from,
        uint256 tokenId,
        bytes data
    );
}