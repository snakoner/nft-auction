import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {Offer, NFT, ERC721Token} from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import { getTransactionFee } from "./common";

// market deployment data
const fee = BigInt(20);  // 0.2%
const minDuration = 60 * 60 * 24; // 1 day

const batchSize = 20;
const tokenId = 0;
const offerValue = ethers.parseEther("0.1");
const feeNumerator = BigInt(200); // 2%

let market: Offer;
let nft: NFT;
let nftERC2981: ERC721Token;
let owner: HardhatEthersSigner;
let offerer: HardhatEthersSigner;
let lotInfo = {
    token: ethers.ZeroAddress,
    tokenId: tokenId,
    price: ethers.parseEther("0.1"),
    duration: 60 * 60 * 24 * 2,
};

/* helpers */
const getLotAddedEvents = async(market: Offer) => {
    let events = await market.queryFilter(market.filters.OfferAdded(), 0, "latest");
    if (events.length == 0)
        return null;

    let result: any[] = [];
    for (let i = 0; i < events.length; i++) {
        result.push(
            {
                id: events[i].args?.id,
                token: events[i].args?.token,
                tokenId: events[i].args?.tokenId,
                creator: events[i].args?.creator
            }
        );
    }

    return result;
}

const getLotApprovedEvent = async(market: Offer) => {
    let events = await market.queryFilter(market.filters.OfferAccepted(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        buyer: events[0].args?.buyer,
        price: events[0].args?.price,
    };
}

const getLotClosedEvent = async(market: Offer) => {
    let events = await market.queryFilter(market.filters.OfferClosed(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
    };
}

const getLotOfferedEvent = async(market: Offer) => {
    let events = await market.queryFilter(market.filters.OfferPlaced(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        offerer: events[0].args?.offerer,
        price: events[0].args?.price,
    };
}

const addLot = async(market: Offer, nft: NFT) => {
    await market.addOffer(
        lotInfo.token,
        lotInfo.tokenId,
        lotInfo.duration
    );

    return lotInfo;
}

const setWhitelist = async(market: Offer, nft: any) => {
    await market.setWhitelist(await nft.getAddress(), true);
}

const init = async() => {
    owner = (await ethers.getSigners())[0];
    offerer = (await ethers.getSigners())[1];
    
    // nft
    const nftFactory = await ethers.getContractFactory("NFT");
    nft = await nftFactory.deploy();
    await nft.waitForDeployment();
    
    lotInfo.token = await nft.getAddress();

    // auction
    const marketFactory = await ethers.getContractFactory("Offer");
    market = await marketFactory.deploy(fee, minDuration);
    await market.waitForDeployment();

    // mint and approve NFT
    for (let i = 0; i < batchSize; i++) {
        await nft.mint();
        await nft.approve(await market.getAddress(), i);    
    }

    // mint ERC2981 nft
    const nftERC2981Factory = await ethers.getContractFactory("ERC721Token");
    nftERC2981 = await nftERC2981Factory.deploy(
        await owner.getAddress(),
        "NFT ERC2981",
        "NFT",
        "https://token-cdn-domain/{id}.json",
    );

    await nftERC2981.waitForDeployment();
    await nftERC2981.mint(await owner.getAddress(), feeNumerator);
    await nftERC2981.approve(await market.getAddress(), 0);

    await setWhitelist(market, nft);
    await setWhitelist(market, nftERC2981);

    expect(await nft.ownerOf(tokenId)).to.be.eq(await owner.getAddress());
    await nft.approve(await market.getAddress(), tokenId);
    expect(await nft.getApproved(tokenId)).to.be.eq(await market.getAddress());
}

describe("Offer test", function() {
    beforeEach(async function () {
        await init();
    });

    it ("Should be possible to add lot", async function() {
        await addLot(market, nft);

        // check ownership of nft{tokenId}
        expect(await nft.ownerOf(lotInfo.tokenId)).to.be.eq(await market.getAddress());

        // check event
        const events = await getLotAddedEvents(market);
        expect(events.length).to.be.eq(1);
        const event = events[0];
        if (event) {
            expect(event.creator).to.be.eq(await owner.getAddress());
            expect(event.id).to.be.eq(Number(await market.totalLots()) - 1);
            expect(event.token).to.be.eq(await nft.getAddress());
            expect(event.tokenId).to.be.eq(lotInfo.tokenId);    
        } else {
            throw Error("LotAdded event wasn't emitted");
        }

        // check storage
        const auctionLot = await market.getLotInfo(event.id);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.token).to.be.eq(await nft.getAddress());
        expect(auctionLot.price).to.be.eq(0);
        expect(auctionLot.state).to.be.eq(0);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.buyer).to.be.eq(await owner.getAddress());
    });

    it ("Should be possible to offer lot", async function() {
        await addLot(market, nft);
        
        await market.connect(offerer).placeOffer(0, {value: offerValue});

        // check events
        const event = await getLotOfferedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(event?.offerer).to.be.eq(offerer.address);
        expect(event?.price).to.be.eq(offerValue);
    });

    it ("Should not be possible to approve lot if LotState is Created", async function() {
        await addLot(market, nft);
        await expect(market.acceptOffer(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should be possible to approve lot", async function() {
        await addLot(market, nft);
        
        await market.connect(offerer).placeOffer(0, {value: offerValue});

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await market.acceptOffer(0);
        const receipt = await tx.wait();
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        const lotInfo = await market.getLotInfo(0);
        const feeValue = lotInfo.price * fee / BigInt(10000);
        const transactionFee = getTransactionFee(tx, receipt);

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(lotInfo.price - transactionFee - feeValue);

        // check events
        const event = await getLotApprovedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(event?.buyer).to.be.eq(await offerer.getAddress());
        expect(event?.price).to.be.eq(lotInfo.price - feeValue);
        expect(await nft.ownerOf(0)).to.be.eq(await offerer.getAddress());
    });

    it ("Should be possible to withdraw fee", async function() {
        await addLot(market, nft);
        
        await market.connect(offerer).placeOffer(0, {value: offerValue});
        await market.acceptOffer(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());

        const tx = await market.withdrawFee(await owner.getAddress());
        const receipt = await tx.wait();
        const feeValue = (await market.getLotInfo(0)).price * fee / BigInt(10000);
        const transactionFee = getTransactionFee(tx, receipt);
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(feeValue - transactionFee);
    });

    it ("Should be possible to update fee", async function() {
        expect(await market.fee()).to.be.eq(fee);

        const newFee = 400;
        await market.updateFee(newFee); 

        expect(await market.fee()).to.be.eq(newFee);
    });

    it ("Should be batch add lot", async function() {
        const tokenIds: bigint[] = [];
        const durations: bigint[] = [];

        for (let i = 0; i < batchSize; i++) {
            tokenIds.push(BigInt(i));
            durations.push(BigInt(60 * 60 * 24 * 2));
        }

        await market.addOfferBatch(await nft.getAddress(), tokenIds, durations);
        const events = await getLotAddedEvents(market);
        expect(events.length).to.be.eq(batchSize);

        for (let i = 0; i < batchSize; i++) {
            expect(events[i].id).to.be.eq(i);
            expect(events[i].token).to.be.eq(await nft.getAddress());
            expect(events[i].tokenId).to.be.eq(tokenIds[i]);
            expect(events[i].creator).to.be.eq(await owner.getAddress());
        }

        expect(await market.totalLots()).to.be.eq(batchSize);
    });

    it ("Should be withhold the commission for ERC2981", async function() {
        await market.addOffer(await nftERC2981.getAddress(), 0, lotInfo.duration);
        
        await market.connect(offerer).placeOffer(0, {value: offerValue});
        await market.acceptOffer(0);
        const event = await getLotApprovedEvent(market);

        const realPrice = event?.price;
        const royaltyInfo = await market.royaltyInfo(await nftERC2981.getAddress(), 0, offerValue);
        const calculatedPrice = offerValue - royaltyInfo.amount - (offerValue - royaltyInfo.amount) * fee / BigInt(10000);

        expect(realPrice).to.be.eq(calculatedPrice);
    });

    it ("Should not be possible to close lot if AuctionState is Sold", async function() {
        await addLot(market, nft);
        await market.connect(offerer).placeOffer(0, {value: offerValue});
        await market.acceptOffer(0);
        
        await expect(market.closeOffer(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should not be possible to close lot by offerrer if AuctionState is Pending", async function() {
        await addLot(market, nft);

        await market.connect(offerer).placeOffer(0, {value: offerValue});

        await expect(market.connect(offerer).closeOffer(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should not be possible to close lot by offerrer if AuctionState is Created", async function() {
        await addLot(market, nft);
        await expect(market.connect(offerer).closeOffer(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should be possible to close lot by offerrer if AuctionState is Timeout", async function() {
        await addLot(market, nft);

        await market.connect(offerer).placeOffer(0, {value: offerValue});

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');
        const ofBalanceBefore = await ethers.provider.getBalance(await offerer.getAddress());
        const tx = await market.connect(offerer).closeOffer(0);
        const receipt = await tx.wait();

        const transactionFee = getTransactionFee(tx, receipt);

        const ofBalanceAfter = await ethers.provider.getBalance(await offerer.getAddress());

        expect((ofBalanceAfter - ofBalanceBefore)).to.be.eq(offerValue - transactionFee);
        expect(await nft.ownerOf(0)).to.be.eq(await owner.getAddress());
    });

    it ("Should be possible to close lot by owner", async function() {
        await addLot(market, nft);
        await market.closeOffer(0);

        // check events
        const event = await getLotClosedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(await nft.ownerOf(0)).to.be.eq(owner.address);
        expect((await market.getLotInfo(0)).state).to.be.eq(4);
    });

    it ("Should not be possible to close lot if AuctionState is Closed", async function() {
        await addLot(market, nft);
        await market.closeOffer(0);

        await expect(market.closeOffer(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });
})