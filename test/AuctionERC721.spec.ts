import { loadFixture, ethers, expect } from "./setup";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/src/signers";
import { AuctionERC721, NFT } from "../typechain-types";

const tokenId = 0;

interface Bidder {
    signer: HardhatEthersSigner;
    bid: bigint;
};

describe("AuctionERC721 test", function() {
    /* helpers */
    const getLotAddedEvent = async(contract: AuctionERC721) => {
        let events = await contract.queryFilter(contract.filters.LotAdded(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
            item: events[0].args?.item,
            tokenId: events[0].args?.tokenId,
            startPrice: events[0].args?.startPrice,
            timeout: events[0].args?.timeout,
            creator: events[0].args?.creator
        };
    }

    const getLotBiddedEvents = async(contract: AuctionERC721) => {
        let events = await contract.queryFilter(contract.filters.LotBidded(), 0, "latest");
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

    const getAuctionEndedEvent = async(contract: AuctionERC721) => {
        let events = await contract.queryFilter(contract.filters.LotEnded(), 0, "latest");
        if (events.length == 0)
            return null;

        return {
            id: events[0].args?.id,
            winner: events[0].args?.winner,
            finalPrice: events[0].args?.finalPrice,
        };
    }

    const addLot = async(contract: AuctionERC721, nft: NFT) => {
        const lotInfo = {
            item: await nft.getAddress(),
            tokenId: tokenId,
            startPrice: ethers.parseEther("0.1"),
            duration: 60 * 60 * 24 * 2,      // 2 days
        };

        await contract.addLot(
            lotInfo.item,
            lotInfo.tokenId,
            lotInfo.startPrice,
            lotInfo.duration
        );

        return lotInfo;
    }

    async function deploy() {
        const owner = (await ethers.getSigners())[0];
        const accounts = (await ethers.getSigners()).slice(1,);
        
        // nft
        const nftFactory = await ethers.getContractFactory("NFT");
        const nft = await nftFactory.deploy();
        await nft.waitForDeployment();
        
        // auction
        const auctionFactory = await ethers.getContractFactory("AuctionERC721");
        const auction = await auctionFactory.deploy();
        await auction.waitForDeployment();

        // mint and approve NFT
        await nft.mint();
        await nft.approve(await auction.getAddress(), 0);

        expect(await nft.ownerOf(tokenId)).to.be.eq(await owner.getAddress());
        await nft.approve(await auction.getAddress(), tokenId);
        expect(await nft.getApproved(tokenId)).to.be.eq(await auction.getAddress());

        // create bidders
        let bidders: Bidder[] = [];
        let prevBid = ethers.parseEther("0.1");
        const step = ethers.parseEther("0.1");
        for (const acc of  accounts) {
            bidders.push({
                signer: acc,
                bid: prevBid + step,
            });

            prevBid += step;
        }

        return {auction, nft, owner, bidders};
    }

    it ("Should be possible to add lot", async function() {
        const {auction, nft, owner} = await loadFixture(deploy);        
        
        const lotInfo = await addLot(auction, nft);
        // check ownership of nft{tokenId}
        expect(await nft.ownerOf(lotInfo.tokenId)).to.be.eq(await auction.getAddress());

        // check event
        const event = await getLotAddedEvent(auction);
        if (event) {
            expect(event.creator).to.be.eq(await owner.getAddress());
            expect(event.id).to.be.eq(Number(await auction.totalLots()) - 1);
            expect(event.item).to.be.eq(await nft.getAddress());
            expect(event.startPrice).to.be.eq(lotInfo.startPrice);
            expect(event.tokenId).to.be.eq(lotInfo.tokenId);    
        } else {
            throw Error("LotAdded event wasn't emitted");
        }

        // check storage
        const auctionLot = await auction.getLotInfo(event.id);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.winner).to.be.eq(await owner.getAddress());
        expect(auctionLot.item).to.be.eq(await nft.getAddress());
        expect(auctionLot.startPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.lastPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.bidsNumber).to.be.eq(0);    
        expect(auctionLot.state).to.be.eq(0); 
    });

    it ("Should be possible to make bid", async function() {
        const {auction, nft, bidders} = await loadFixture(deploy);        

        const lotInfo = await addLot(auction, nft);
        
        // make bid and make sure that prev bid returns to bidder
        for (let i = 0; i < bidders.length; i++) {
            let beforeBalance = BigInt(0);
            let afterBalance = BigInt(0);

            if (i != 0)
                beforeBalance = (await ethers.provider.getBalance(await bidders[i - 1].signer.getAddress()))

            await auction.connect(bidders[i].signer).bidLot(0, {value: bidders[i].bid});

            if (i != 0) {
                afterBalance = (await ethers.provider.getBalance(await bidders[i - 1].signer.getAddress()));
                expect(ethers.formatUnits(afterBalance - beforeBalance)).to.be.eq(ethers.formatUnits(bidders[i - 1].bid));
            }
        }

        // check events
        const events = await getLotBiddedEvents(auction);
        expect(events?.length).to.be.eq(bidders.length);

        for (let i = 0; i < events.length; i++) {
            expect(events[i].id).to.be.eq(0);
            expect(events[i].bidder).to.be.eq(bidders[i].signer.address);
            expect(events[i].newPrice).to.be.eq(bidders[i].bid);
        }
    });

    it ("Should be possible to end auction if there is bidders", async function() {
        const {auction, nft, owner, bidders} = await loadFixture(deploy);        
        const bidder = bidders[0];

        const lotInfo = await addLot(auction, nft);
        
        await auction.connect(bidder.signer).bidLot(0, {value: bidder.bid});

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        expect(await ethers.provider.getBalance(await auction.getAddress())).to.be.eq(bidder.bid);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await auction.endLot(0);
        const receipt = await tx.wait();

        /* checks */
        // nft owner is last bidder
        expect(await nft.ownerOf(0)).to.be.eq(bidder.signer.address);
        // contract balance is 0
        expect(await ethers.provider.getBalance(await auction.getAddress())).to.be.eq(0);

        // previous owner of nft receinve last bid in ETH
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());
		const transactionFee = receipt.gasUsed * (tx.gasPrice || receipt.effectiveGasPrice);

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(bidder.bid - transactionFee);

        // storage after-check
        const auctionLot = await auction.getLotInfo(0);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.winner).to.be.eq(await bidder.signer.getAddress());
        expect(auctionLot.item).to.be.eq(await nft.getAddress());
        expect(auctionLot.startPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.lastPrice).to.be.eq(bidder.bid);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.bidsNumber).to.be.eq(1);    
        expect(auctionLot.state).to.be.eq(2); 

        // events check
        const event = await getAuctionEndedEvent(auction);
        expect(event?.id).to.be.eq(0);
        expect(event?.winner).to.be.eq(bidder.signer.address);
        expect(event?.finalPrice).to.be.eq(bidder.bid);
    });

    it ("Should be possible to end auction if there is no bidders", async function() {
        const {auction, nft, owner} = await loadFixture(deploy);        

        const lotInfo = await addLot(auction, nft);

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        expect(await ethers.provider.getBalance(await auction.getAddress())).to.be.eq(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await auction.endLot(0);
        const receipt = await tx.wait();

        /* checks */
        // nft owner is last bidder
        expect(await nft.ownerOf(0)).to.be.eq(owner.address);
        // contract balance is 0
        expect(await ethers.provider.getBalance(await auction.getAddress())).to.be.eq(0);

        // previous owner of nft receinve last bid in ETH
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());
		const transactionFee = receipt.gasUsed * (tx.gasPrice || receipt.effectiveGasPrice);

        expect(ownerBalanceBefore - ownerBalanceAfter).to.be.eq(transactionFee);

        // events check
        const event = await getAuctionEndedEvent(auction);
        expect(event?.id).to.be.eq(0);
        expect(event?.winner).to.be.eq(owner.address);
        expect(event?.finalPrice).to.be.eq(0);        
    });

    it ("Should not be possible to end auction if AuctionState is active", async function() {
        const {auction, nft} = await loadFixture(deploy);        

        const lotInfo = await addLot(auction, nft);
        
        await expect(auction.endLot(0)).to.be.revertedWithCustomError(auction, "AuctionERC721UnexpectedState");
    });

    it ("Should not be possible to end auction if AuctionState is Ended", async function() {
        const {auction, nft} = await loadFixture(deploy);        

        const lotInfo = await addLot(auction, nft);
        
        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');
        await auction.endLot(0);

        await expect(auction.endLot(0)).to.be.revertedWithCustomError(auction, "AuctionERC721UnexpectedState");
    });
})
