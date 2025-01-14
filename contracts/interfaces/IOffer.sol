// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IOffer {
    error OnlyCreatorAllowed();

    error InsufficientValue();

    event OfferAdded(
        uint256 indexed id,
        address indexed token,
        uint256 tokenId,
        uint64 timeout,
        address indexed creator
    );

    event OfferPlaced(
        uint256 indexed id,
        address indexed offerer,
        uint256 price
    );

    event OfferAccepted (
        uint256 indexed id,
        address indexed buyer,
        uint256 price
    );

    event OfferClosed (
        uint256 indexed id,
        address indexed closer
    );

    event MinDurationUpdated(
        uint64 oldMinDuration,
        uint64 newMinDuration
    );
}