import {ContractTransactionResponse, ContractTransactionReceipt} from "ethers";

export const getTransactionFee = (tx: ContractTransactionResponse, receipt: ContractTransactionReceipt) => {
    return receipt.gasUsed * (tx.gasPrice || receipt.effectiveGasPrice);
}

