// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IMarketplaceCommonERC721 {
    error ERC721OwnershipError();

    error ERC721AllowanceError();

    error ERC721NoERC721InterfaceSupport();

    error ERC721InvalidInputData();

    error ERC721LotNotExist();

    error ERC721TransactionFailed();

    error ERC721UnexpectedState(bytes32 expectedState);

    error ERC721FeeUpdateFailed();

    error ERC721ZeroFeeValue();

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