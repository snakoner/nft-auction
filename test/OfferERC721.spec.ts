import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {OfferERC721, NFT} from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import {ContractTransactionResponse, ContractTransactionReceipt} from "ethers";

const tokenId = 0;
const fee: bigint = BigInt(20);  // 0.2%
const offerValue = ethers.parseEther("0.1");

describe("OfferERC721 test", function() {
    let fixed: OfferERC721;
    let nft: NFT;
    let owner: HardhatEthersSigner;
    let offerer: HardhatEthersSigner;
    let lotInfo = {
        item: ethers.ZeroAddress,
        tokenId: tokenId,
        price: ethers.parseEther("0.1"),
        duration: 60 * 60 * 24 * 2,      // 2 days
    };

    /* helpers */
    const getLotAddedEvent = async(contract: OfferERC721) => {
        let events = await contract.queryFilter(contract.filters.LotAdded(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
            item: events[0].args?.item,
            tokenId: events[0].args?.tokenId,
            creator: events[0].args?.creator
        };
    }

    const getLotApprovedEvent = async(contract: OfferERC721) => {
        let events = await contract.queryFilter(contract.filters.LotApproved(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
            buyer: events[0].args?.buyer,
            price: events[0].args?.price,
        };
    }

    const getLotClosedEvent = async(contract: OfferERC721) => {
        let events = await contract.queryFilter(contract.filters.LotClosed(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
        };
    }

    const getLotOfferedEvent = async(contract: OfferERC721) => {
        let events = await contract.queryFilter(contract.filters.LotOffered(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
            offerer: events[0].args?.offerer,
            price: events[0].args?.price,
        };
    }

    const addLot = async(contract: OfferERC721, nft: NFT) => {
        await contract.addLot(
            lotInfo.item,
            lotInfo.tokenId,
        );

        return lotInfo;
    }

    const getTransactionFee = (tx: ContractTransactionResponse, receipt: ContractTransactionReceipt) => {
        return receipt.gasUsed * (tx.gasPrice || receipt.effectiveGasPrice);
    }
    
    async function init() {
        owner = (await ethers.getSigners())[0];
        offerer = (await ethers.getSigners())[1];
        
        // nft
        const nftFactory = await ethers.getContractFactory("NFT");
        nft = await nftFactory.deploy();
        await nft.waitForDeployment();
        
        lotInfo.item = await nft.getAddress();

        // auction
        const fixedFactory = await ethers.getContractFactory("OfferERC721");
        fixed = await fixedFactory.deploy(fee);
        await fixed.waitForDeployment();

        // mint and approve NFT
        await nft.mint();
        await nft.approve(await fixed.getAddress(), 0);

        expect(await nft.ownerOf(tokenId)).to.be.eq(await owner.getAddress());
        await nft.approve(await fixed.getAddress(), tokenId);
        expect(await nft.getApproved(tokenId)).to.be.eq(await fixed.getAddress());
    }

    beforeEach(async function () {
        await init();
    });

    it ("Should be possible to add lot", async function() {
        await addLot(fixed, nft);

        // check ownership of nft{tokenId}
        expect(await nft.ownerOf(lotInfo.tokenId)).to.be.eq(await fixed.getAddress());

        // check event
        const event = await getLotAddedEvent(fixed);
        if (event) {
            expect(event.creator).to.be.eq(await owner.getAddress());
            expect(event.id).to.be.eq(Number(await fixed.totalLots()) - 1);
            expect(event.item).to.be.eq(await nft.getAddress());
            expect(event.tokenId).to.be.eq(lotInfo.tokenId);    
        } else {
            throw Error("LotAdded event wasn't emitted");
        }

        // check storage
        const auctionLot = await fixed.getLotInfo(event.id);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.item).to.be.eq(await nft.getAddress());
        expect(auctionLot.price).to.be.eq(0);
        expect(auctionLot.state).to.be.eq(0);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.buyer).to.be.eq(await owner.getAddress());
    });

    it ("Should be possible to offer lot", async function() {
        await addLot(fixed, nft);
        
        await fixed.connect(offerer).offerLot(0, {value: offerValue});

        // check events
        const event = await getLotOfferedEvent(fixed);
        expect(event?.id).to.be.eq(0);
        expect(event?.offerer).to.be.eq(offerer.address);
        expect(event?.price).to.be.eq(offerValue);
    });

    it ("Should not be possible to approve lot if LotState is Created", async function() {
        await addLot(fixed, nft);
        await expect(fixed.approveLot(0)).to.be.revertedWithCustomError(fixed, "ERC721UnexpectedState");
    });

    it ("Should be possible to approve lot", async function() {
        await addLot(fixed, nft);
        
        await fixed.connect(offerer).offerLot(0, {value: offerValue});

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await fixed.approveLot(0);
        const receipt = await tx.wait();
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        const lotInfo = await fixed.getLotInfo(0);
        const feeValue = lotInfo.price * fee / BigInt(10000);
        const transactionFee = getTransactionFee(tx, receipt);

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(lotInfo.price - transactionFee - feeValue);

        // check events
        const event = await getLotApprovedEvent(fixed);
        expect(event?.id).to.be.eq(0);
        expect(event?.buyer).to.be.eq(await offerer.getAddress());
        expect(event?.price).to.be.eq(lotInfo.price - feeValue);
        expect(await nft.ownerOf(0)).to.be.eq(await offerer.getAddress());
    });

    it ("Should be possible to close lot", async function() {
        await addLot(fixed, nft);
        await fixed.closeLot(0);

        // check events
        const event = await getLotClosedEvent(fixed);
        expect(event?.id).to.be.eq(0);
        expect(await nft.ownerOf(0)).to.be.eq(owner.address);
        expect((await fixed.getLotInfo(0)).state).to.be.eq(3);
    });

    it ("Should not be possible to close lot if AuctionState is Sold", async function() {
        await addLot(fixed, nft);
        await fixed.closeLot(0);

        await expect(fixed.closeLot(0)).to.be.revertedWithCustomError(fixed, "ERC721UnexpectedState");
    });


    it ("Should not be possible to close lot if AuctionState is Closed", async function() {
        await addLot(fixed, nft);
        await fixed.connect(offerer).offerLot(0, {value: offerValue});
        await fixed.approveLot(0);
        
        await expect(fixed.closeLot(0)).to.be.revertedWithCustomError(fixed, "ERC721UnexpectedState");
    });


    it ("Should be possible to withdraw fee", async function() {
        await addLot(fixed, nft);
        
        await fixed.connect(offerer).offerLot(0, {value: offerValue});
        await fixed.approveLot(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());

        const tx = await fixed.withdrawFee(await owner.getAddress());
        const receipt = await tx.wait();
        const feeValue = (await fixed.getLotInfo(0)).price * fee / BigInt(10000);
        const transactionFee = getTransactionFee(tx, receipt);
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(feeValue - transactionFee);
    });

    it ("Should be possible to update fee", async function() {
        expect(await fixed.fee()).to.be.eq(fee);

        const newFee = 400;
        await fixed.updateFee(newFee); 

        expect(await fixed.fee()).to.be.eq(newFee);
    });
})