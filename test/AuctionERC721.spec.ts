import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {Auction, NFT, ERC721Token} from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import { getTransactionFee } from "./common";

// market deployment data
const name = "Auction Marketplace ERC721";
const fee = BigInt(20);  // 0.2%
const minDuration = 60 * 60 * 24; // 1 day
const deadlineForExtensionTime = 60; // 60 seconds

const batchSize = 20;
const tokenId = 0;
const feeNumerator = BigInt(200); // 2%

interface Bidder {
    signer: HardhatEthersSigner;
    bid: bigint;
};

let market: Auction;
let nft: NFT;
let nftERC2981: ERC721Token;
let owner: HardhatEthersSigner;
let bidders: Bidder[] = [];
let lotInfo = {
    token: ethers.ZeroAddress,
    tokenId: tokenId,
    startPrice: ethers.parseEther("0.1"),
    duration: 60 * 60 * 24 * 2,      // 2 days
    minBidStep: 0,
    extensionTime: 0,
};

/* helpers */
const getLotAddedEvents = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.LotAdded(), 0, "latest");
    if (events.length == 0)
        return null;

    let result: any[] = [];
    for (let i = 0; i < events.length; i++) {
        result.push(
            {
                id: events[i].args?.id,
                token: events[i].args?.token,
                tokenId: events[i].args?.tokenId,
                startPrice: events[i].args?.startPrice,
                timeout: events[i].args?.timeout,
                creator: events[i].args?.creator
            }
        );    
    }

    return result;
}

const getLotBiddedEvents = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.BidPlaced(), 0, "latest");
    if (events.length == 0)
        return null;

    const result: any[] = [];
    for (const e of events) {
        result.push({
            id: e.args?.id,
            bidder: e.args?.bidder,
            newPrice: e.args?.newPrice,
        });
    }

    return result;
}

const getLotEndedEvent = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.AuctionCompleted(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        winner: events[0].args?.winner,
        finalPrice: events[0].args?.finalPrice,
    };
}

const getFeeWithdrawedEvents = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.FeeWithdrawed(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        to: events[0].args?.to,
        amount: events[0].args?.amount,
    };
}

const getTimeoutExtendedEvent = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.TimeoutExtended(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        newTimeout: events[0].args?.newTimeout,
    };
}

const getFeeUpdatedEvents = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.FeeUpdated(), 0, "latest");
    if (events.length == 0)
        return null;

    const result: any[] = [];
    for (const e of events) {
        result.push({
            oldFee: e.args?.oldFee,
            newFee: e.args?.newFee,    
        });
    }

    return result;
}

const getMinDurationUpdatedEvents = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.MinDurationUpdated(), 0, "latest");
    if (events.length == 0)
        return null;

    const result: any[] = [];
    for (const e of events) {
        result.push({
            oldMinDuration: e.args?.oldMinDuration,
            newMinDuration: e.args?.newMinDuration,    
        });
    }

    return result;
}

const getDeadlineForExtensionTimeUpdatedEvents = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.DeadlineForExtensionTimeUpdated(), 0, "latest");
    if (events.length == 0)
        return null;

    const result: any[] = [];
    for (const e of events) {
        result.push({
            oldTime: e.args?.oldTime,
            newTime: e.args?.newTime,    
        });
    }

    return result;
}

const addLot = async(market: Auction) => {
    await market.addLot(
        lotInfo.token,
        lotInfo.tokenId,
        lotInfo.startPrice,
        lotInfo.minBidStep,
        lotInfo.duration,
        lotInfo.extensionTime
    );

    return lotInfo;
}

const setWhitelist = async(market: Auction, nft: any) => {
    await market.setWhitelist(await nft.getAddress(), true);
}

const init = async() => {
    owner = (await ethers.getSigners())[0];
    const accounts = (await ethers.getSigners()).slice(1,);
    
    // nft
    const nftFactory = await ethers.getContractFactory("NFT");
    nft = await nftFactory.deploy();
    await nft.waitForDeployment();
    
    lotInfo.token = await nft.getAddress();

    // auction
    const marketFactory = await ethers.getContractFactory("Auction");
    market = await marketFactory.deploy(fee, minDuration, deadlineForExtensionTime);
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

    expect(await nft.ownerOf(tokenId)).to.be.eq(await owner.getAddress());
    await nft.approve(await market.getAddress(), tokenId);
    expect(await nft.getApproved(tokenId)).to.be.eq(await market.getAddress());

    // set whitelist
    setWhitelist(market, nft);
    setWhitelist(market, nftERC2981);

    // create bidders
    bidders.length = 0;
    let prevBid = ethers.parseEther("0.1");
    const step = ethers.parseEther("0.1");
    for (const acc of  accounts) {
        bidders.push({
            signer: acc,
            bid: prevBid + step,
        });
        prevBid += step;
    }
}

describe("Auction test", function() {
    beforeEach(async function() {
        await init();
    });

    it ("Should be possible to add lot", async function() {
        await addLot(market);

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
            expect(event.startPrice).to.be.eq(lotInfo.startPrice);
            expect(event.tokenId).to.be.eq(lotInfo.tokenId);    
        } else {
            throw Error("LotAdded event wasn't emitted");
        }

        // check storage
        const auctionLot = await market.getLotInfo(event.id);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.winner).to.be.eq(await owner.getAddress());
        expect(auctionLot.token).to.be.eq(await nft.getAddress());
        expect(auctionLot.startPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.lastPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.state).to.be.eq(0); 
    });

    it ("Should be possible to make bid", async function() {
        await addLot(market);
        
        // make bid and make sure that prev bid returns to bidder
        for (let i = 0; i < bidders.length; i++) {
            let beforeBalance = BigInt(0);
            let afterBalance = BigInt(0);

            if (i != 0)
                beforeBalance = (await ethers.provider.getBalance(await bidders[i - 1].signer.getAddress()))

            await market.connect(bidders[i].signer).placeBid(0, {value: bidders[i].bid});

            if (i != 0) {
                afterBalance = (await ethers.provider.getBalance(await bidders[i - 1].signer.getAddress()));
                expect(ethers.formatUnits(afterBalance - beforeBalance)).to.be.eq(ethers.formatUnits(bidders[i - 1].bid));
            }
        }

        // check events
        const events = await getLotBiddedEvents(market);
        expect(events?.length).to.be.eq(bidders.length);

        for (let i = 0; i < events.length; i++) {
            expect(events[i].id).to.be.eq(0);
            expect(events[i].bidder).to.be.eq(bidders[i].signer.address);
            expect(events[i].newPrice).to.be.eq(bidders[i].bid);
        }
    });

    it ("Should be possible to end auction if there is bidders", async function() {
        const bidder = bidders[0];

        await addLot(market);
        
        await market.connect(bidder.signer).placeBid(0, {value: bidder.bid});

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(bidder.bid);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await market.completeAuction(0);
        const receipt = await tx.wait();

        const feeValue = bidder.bid * fee / BigInt(10000);

        /* checks */
        // nft owner is last bidder
        expect(await nft.ownerOf(0)).to.be.eq(bidder.signer.address);
        // contract balance is 0
        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(feeValue);

        // previous owner of nft receinve last bid in ETH
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(bidder.bid - getTransactionFee(tx, receipt) - feeValue);

        // storage after-check
        const auctionLot = await market.getLotInfo(0);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.winner).to.be.eq(await bidder.signer.getAddress());
        expect(auctionLot.token).to.be.eq(await nft.getAddress());
        expect(auctionLot.startPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.lastPrice).to.be.eq(bidder.bid);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.state).to.be.eq(2); 

        // events check
        const event = await getLotEndedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(event?.winner).to.be.eq(bidder.signer.address);
        expect(event?.finalPrice).to.be.eq(bidder.bid - feeValue);
    });

    it ("Should be possible to end auction if there is no bidders", async function() {
        await addLot(market);

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await market.completeAuction(0);
        const receipt = await tx.wait();

        /* checks */
        // nft owner is last bidder
        expect(await nft.ownerOf(0)).to.be.eq(owner.address);
        // contract balance is 0
        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(0);

        // previous owner of nft receinve last bid in ETH
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        expect(ownerBalanceBefore - ownerBalanceAfter).to.be.eq(getTransactionFee(tx, receipt));

        // events check
        const event = await getLotEndedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(event?.winner).to.be.eq(owner.address);
        expect(event?.finalPrice).to.be.eq(0);        
    });

    it ("Should not be possible to end auction if AuctionState is active", async function() {
        await addLot(market);
        
        await expect(market.completeAuction(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should not be possible to end auction if AuctionState is Ended", async function() {
        await addLot(market);
        
        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');
        await market.completeAuction(0);

        await expect(market.completeAuction(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should be possible to withdraw fee", async function() {
        const bidder = bidders[0];

        await addLot(market);
        
        await market.connect(bidder.signer).placeBid(0, {value: bidder.bid});

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');
        await market.completeAuction(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());

        const feeValue = bidder.bid * fee / BigInt(10000);
        const tx = await market.withdrawFee(await owner.getAddress());
        const receipt = await tx.wait();
        const transactionFee = getTransactionFee(tx, receipt);

        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());
        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(feeValue - transactionFee);
        
        const event = await getFeeWithdrawedEvents(market);

        expect(event?.to).to.be.eq(await owner.getAddress());
        expect(event?.amount).to.be.eq(feeValue);
    });

    it ("Should be possible to update fee", async function() {
        expect(await market.fee()).to.be.eq(fee);
        const newFee = 400; //
        await market.updateFee(newFee); 

        expect(await market.fee()).to.be.eq(newFee);

        const events = await getFeeUpdatedEvents(market);
        expect(events?.length).to.be.eq(2);

        expect(events[0].oldFee).to.be.eq(0);
        expect(events[0].newFee).to.be.eq(fee);
        expect(events[1].oldFee).to.be.eq(fee);
        expect(events[1].newFee).to.be.eq(newFee);
    });

    it ("Should be batch add lot", async function() {
        const tokenIds: bigint[] = [];
        const prices: bigint[] = [];
        const durations: bigint[] = [];
        const extensionTimes: bigint[] = [];
        const minBidSteps: bigint[] = [];

        for (let i = 0; i < batchSize; i++) {
            tokenIds.push(BigInt(i));
            prices.push(ethers.parseEther("0.1"));
            durations.push(BigInt(60 * 60 * 24 * 2));
            extensionTimes.push(BigInt(0));
            minBidSteps.push(BigInt(0));
        }

        await market.addLotBatch(await nft.getAddress(), tokenIds, prices, minBidSteps, durations, extensionTimes);
        const events = await getLotAddedEvents(market);
        expect(events.length).to.be.eq(batchSize);

        for (let i = 0; i < batchSize; i++) {
            expect(events[i].id).to.be.eq(i);
            expect(events[i].token).to.be.eq(await nft.getAddress());
            expect(events[i].tokenId).to.be.eq(tokenIds[i]);
            expect(events[i].startPrice).to.be.eq(prices[i]);
            expect(events[i].creator).to.be.eq(await owner.getAddress());
        }

        expect(await market.totalLots()).to.be.eq(batchSize);
    });

    it ("Should be withhold the commission for ERC2981", async function() {
        const bidder = bidders[0];
        await market.addLot(await nftERC2981.getAddress(), 0, lotInfo.startPrice, 0, lotInfo.duration, 0);
        
        await market.connect(bidder.signer).placeBid(0, {value: bidder.bid});
  
        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        await market.completeAuction(0);

        const event = await getLotEndedEvent(market);

        const realPrice = event?.finalPrice;
        const royaltyInfo = await market.royaltyInfo(await nftERC2981.getAddress(), 0, bidder.bid);
        const calculatedPrice = bidder.bid - royaltyInfo.amount - (bidder.bid - royaltyInfo.amount) * fee / BigInt(10000);

        expect(realPrice).to.be.eq(calculatedPrice);
    });

    it ("Should be negotiate with minBidStep", async function() {
        const bidder = bidders[0];
        const minBidStep = ethers.parseEther("0.01");
        const goodBidValue = lotInfo.startPrice + ethers.parseEther("0.02");
        const badBidValue = lotInfo.startPrice + ethers.parseEther("0.005");

        await market.addLot(await nftERC2981.getAddress(), 0, lotInfo.startPrice, minBidStep, lotInfo.duration, 0);
        
        // bad bid
        await expect(
            market.connect(bidder.signer).placeBid(0, {value: badBidValue})
        ).to.be.revertedWithCustomError(market, "InsufficientBidValue");
        
        // good bid
        market.connect(bidder.signer).placeBid(0, {value: goodBidValue});
    });

    it ("Should be negotiate with extensionTime", async function() {
        const bidder = bidders[0];
        const extensionTime = BigInt(60 * 60); // 1 hour

        await market.addLot(await nftERC2981.getAddress(), 0, lotInfo.startPrice, 0, lotInfo.duration, extensionTime);

        await ethers.provider.send('evm_increaseTime', [lotInfo.duration - 50]);
        await ethers.provider.send('evm_mine');

        const timeoutBefore = (await market.getLotInfo(0)).timeout;

        // time extended
        await market.connect(bidder.signer).placeBid(0, {value: bidder.bid});
        expect((await market.getLotInfo(0)).timeout - timeoutBefore).to.be.closeTo(extensionTime, 10);   // 10 seconds error rate

        const event = await getTimeoutExtendedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(event?.newTimeout).to.be.closeTo(timeoutBefore + extensionTime, 10);
    });

    it ("Should be possible to update minDuration and deadlineForExtensionTime", async function() {
        const prevMinDuration = await market.minDuration();
        const prevDeadlineForExtensionTime = await market.deadlineForExtensionTime();
        const newMinDuration = 60 * 60 * 24 * 2;
        const newDeadlineForExtensionTime = 60 * 2;

        expect(prevMinDuration).to.be.eq(minDuration);
        expect(prevDeadlineForExtensionTime).to.be.eq(deadlineForExtensionTime);
        
        await market.updateMinDuration(newMinDuration);
        expect(await market.minDuration()).to.be.eq(newMinDuration);

        const events0 = await getMinDurationUpdatedEvents(market);
        expect(events0?.length).to.be.eq(2);
        expect(events0[0]?.oldMinDuration).to.be.eq(0);
        expect(events0[0]?.newMinDuration).to.be.eq(prevMinDuration);
        expect(events0[1]?.oldMinDuration).to.be.eq(prevMinDuration);
        expect(events0[1]?.newMinDuration).to.be.eq(newMinDuration);


        await market.updateDeadlineForExtensionTime(newDeadlineForExtensionTime);
        expect(await market.deadlineForExtensionTime()).to.be.eq(newDeadlineForExtensionTime);

        const events1 = await getDeadlineForExtensionTimeUpdatedEvents(market);
        expect(events0?.length).to.be.eq(2);
        expect(events1[0]?.oldTime).to.be.eq(0);
        expect(events1[0]?.newTime).to.be.eq(prevDeadlineForExtensionTime);
        expect(events1[1]?.oldTime).to.be.eq(prevDeadlineForExtensionTime);
        expect(events1[1]?.newTime).to.be.eq(newDeadlineForExtensionTime);
    });
})