// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IOfferERC721 {
    error OfferERC721OnlyCreatorAllowed();

    error OfferERC721InsufficientValue();

    event LotAdded(
        uint256 indexed id,
        address indexed item,
        uint256 tokenId,
        address indexed creator
    );

    event LotOffered(
        uint256 indexed id,
        address indexed offerer,
        uint256 price
    );

    event LotApproved (
        uint256 indexed id,
        address indexed buyer,
        uint256 price
    );

    event LotClosed (
        uint256 indexed id
    );
}