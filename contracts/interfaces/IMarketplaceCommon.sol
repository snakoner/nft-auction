// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IMarketplaceCommon {
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

    event TokenReceived(
        address operator,
        address from,
        uint256 tokenId,
        bytes data
    );

    event FeeUpdated(
        uint24 oldFee,
        uint24 newFee
    );

    event FeeWithdrawed(
        address indexed to,
        uint256 amount
    );
}