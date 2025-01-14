// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IMarketplace {
    error MarketplaceOwnershipError();

    error MarketplaceAllowanceError();

    error MarketplaceNoIERC721Support();

    error MarketplaceNoIERC721ReceiverSupport();

    error MarketplaceInvalidInputData();

    error MarketplaceLotNotExist();

    error MarketplaceTransactionFailed();

    error MarketplaceUnexpectedState(bytes32 expectedState);

    error MarketplaceFeeUpdateFailed();

    error MarketplaceZeroFeeValue();

    error MarketplaceArrayLengthMissmatch();

    event TokenReceived(
        address indexed operator,
        address indexed from,
        uint256 tokenId,
        bytes data
    );

    event FeeUpdated(
        uint96 oldFee,
        uint96 newFee
    );

    event FeeWithdrawed(
        address indexed to,
        uint256 amount
    );
}