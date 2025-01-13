import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {FixedPriceERC721, NFT} from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import {ContractTransactionResponse, ContractTransactionReceipt} from "ethers";

const tokenId = 0;
const fee: bigint = BigInt(20);  // 0.2%

let lotInfo = {
    item: ethers.ZeroAddress,
    tokenId: tokenId,
    price: ethers.parseEther("0.1"),
    duration: 60 * 60 * 24 * 2,      // 2 days
};

interface Bidder {
    signer: HardhatEthersSigner;
    bid: bigint;
};

describe("FixedPriceERC721 test", function() {
    /* helpers */
    const getLotAddedEvent = async(contract: FixedPriceERC721) => {
        let events = await contract.queryFilter(contract.filters.LotAdded(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
            item: events[0].args?.item,
            tokenId: events[0].args?.tokenId,
            price: events[0].args?.price,
            creator: events[0].args?.creator
        };
    }

    const getLotSoldEvent = async(contract: FixedPriceERC721) => {
        let events = await contract.queryFilter(contract.filters.LotSold(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
            buyer: events[0].args?.buyer,
            price: events[0].args?.price,
        };
    }

    const getLotClosedEvent = async(contract: FixedPriceERC721) => {
        let events = await contract.queryFilter(contract.filters.LotClosed(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
        };
    }

    const addLot = async(contract: FixedPriceERC721, nft: NFT) => {
        await contract.addLot(
            lotInfo.item,
            lotInfo.tokenId,
            lotInfo.price,
        );

        return lotInfo;
    }

    const getTransactionFee = (tx: ContractTransactionResponse, receipt: ContractTransactionReceipt) => {
        return receipt.gasUsed * (tx.gasPrice || receipt.effectiveGasPrice);
    }

    async function deploy() {
        const owner = (await ethers.getSigners())[0];
        const buyer = (await ethers.getSigners())[1];
        
        // nft
        const nftFactory = await ethers.getContractFactory("NFT");
        const nft = await nftFactory.deploy();
        await nft.waitForDeployment();
        
        lotInfo.item = await nft.getAddress();

        // auction
        const fixedFactory = await ethers.getContractFactory("FixedPriceERC721");
        const fixed = await fixedFactory.deploy(fee);
        await fixed.waitForDeployment();

        // mint and approve NFT
        await nft.mint();
        await nft.approve(await fixed.getAddress(), 0);

        expect(await nft.ownerOf(tokenId)).to.be.eq(await owner.getAddress());
        await nft.approve(await fixed.getAddress(), tokenId);
        expect(await nft.getApproved(tokenId)).to.be.eq(await fixed.getAddress());

        return {fixed, nft, owner, buyer};
    }

    it ("Should be possible to add lot", async function() {
        const {fixed, nft, owner} = await loadFixture(deploy);        
        
        await addLot(fixed, nft);
        // check ownership of nft{tokenId}
        expect(await nft.ownerOf(lotInfo.tokenId)).to.be.eq(await fixed.getAddress());

        // check event
        const event = await getLotAddedEvent(fixed);
        if (event) {
            expect(event.creator).to.be.eq(await owner.getAddress());
            expect(event.id).to.be.eq(Number(await fixed.totalLots()) - 1);
            expect(event.item).to.be.eq(await nft.getAddress());
            expect(event.price).to.be.eq(lotInfo.price);
            expect(event.tokenId).to.be.eq(lotInfo.tokenId);    
        } else {
            throw Error("LotAdded event wasn't emitted");
        }

        // check storage
        const auctionLot = await fixed.getLotInfo(event.id);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.item).to.be.eq(await nft.getAddress());
        expect(auctionLot.price).to.be.eq(lotInfo.price);
        expect(auctionLot.state).to.be.eq(0);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.buyer).to.be.eq(await owner.getAddress()); 
    });

    it ("Should be possible to buy lot", async function() {
        const {fixed, nft, owner, buyer} = await loadFixture(deploy);        

        await addLot(fixed, nft);
        
        const lotInfo = await fixed.getLotInfo(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
        await fixed.connect(buyer).buyLot(0, {value: lotInfo.price});

        // check events
        const event = await getLotSoldEvent(fixed);

        const fee = await fixed.fee();
        const feeValue = lotInfo.price * fee / BigInt(10000);

        expect(event?.id).to.be.eq(0);
        expect(event?.buyer).to.be.eq(buyer.address);
        expect(event?.price).to.be.eq(lotInfo.price - feeValue);

        expect(await nft.ownerOf(0)).to.be.eq(buyer.address);
        expect((await ethers.provider.getBalance(owner.address)) - ownerBalanceBefore).to.be.eq(lotInfo.price - feeValue);
    });

    it ("Should be possible to close lot", async function() {
        const {fixed, nft, owner, buyer} = await loadFixture(deploy);        

        await addLot(fixed, nft);
        
        await fixed.closeLot(0);

        // check events
        const event = await getLotClosedEvent(fixed);

        expect(event?.id).to.be.eq(0);

        expect(await nft.ownerOf(0)).to.be.eq(owner.address);
        const lotInfo = await fixed.getLotInfo(0);
        expect(lotInfo.state).to.be.eq(2);
    });

    it ("Should not be possible to close lot if AuctionState is Closed", async function() {
        const {fixed, nft} = await loadFixture(deploy);        

        await addLot(fixed, nft);
        await fixed.closeLot(0);

        await expect(fixed.closeLot(0)).to.be.revertedWithCustomError(fixed, "ERC721UnexpectedState");
    });

    it ("Should not be possible to close lot if AuctionState is Sold", async function() {
        const {fixed, nft, buyer} = await loadFixture(deploy);        

        await addLot(fixed, nft);
        await fixed.connect(buyer).buyLot(0, {value: lotInfo.price});

        await expect(fixed.closeLot(0)).to.be.revertedWithCustomError(fixed, "ERC721UnexpectedState");
    });

    it ("Should be possible to withdraw fee", async function() {
        const {fixed, nft, owner, buyer} = await loadFixture(deploy);        

        await addLot(fixed, nft);
        const lotInfo = await fixed.getLotInfo(0);


        await fixed.connect(buyer).buyLot(0, {value: lotInfo.price});

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const feeValue = lotInfo.price * fee / BigInt(10000);
        const tx = await fixed.withdrawFee(await owner.getAddress());
        const receipt = await tx.wait();
        const transactionFee = getTransactionFee(tx, receipt);

        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());
        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(feeValue - transactionFee);
    });

    it ("Should be possible to update fee", async function() {
        const {fixed, nft, owner} = await loadFixture(deploy);        

        expect(await fixed.fee()).to.be.eq(fee);
        const newFee = 400; //
        await fixed.updateFee(newFee); 

        expect(await fixed.fee()).to.be.eq(newFee);
    });

})