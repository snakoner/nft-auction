// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IMarketplaceERC721Common } from "./IMarketplaceERC721Common.sol";

interface IFixedPriceERC721 is IMarketplaceERC721Common {
    error FixedPriceERC721OnlyCreatorAllowed();

    error FixedPriceERC721InsufficientValue();

    event LotAdded(
        uint256 indexed id,
        address indexed item,
        uint256 tokenId,
        uint256 price,
        address indexed creator
    );

    event LotSold (
        uint256 indexed id,
        address indexed buyer,
        uint256 price
    );

    event LotClosed (
        uint256 indexed id
    );
}