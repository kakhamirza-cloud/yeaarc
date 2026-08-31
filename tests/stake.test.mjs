import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import {
  SOFT_STAKE_APR_DAILY,
  claimStakeRewards,
  createPredictionState,
  ensurePlayer,
  stakePoints,
  unstakePoints,
} from "../src/prediction-shared.js";
import {
  STAKE_AUTH_TTL_MS,
  buildStakeAuthMessage,
  verifyStakeAuthorization,
} from "../src/stake-auth.js";

test("stake, accrue, claim, and unstake use the prediction points ledger", () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  const state = createPredictionState();
  const player = ensurePlayer(state, wallet);
  player.points = 1_000;
  const start = Date.UTC(2026, 7, 31, 0, 0, 0);

  assert.deepEqual(stakePoints(state, wallet, 400, start), {
    ok: true,
    staked: 400,
    points: 600,
    totalStaked: 400,
  });

  const oneDayLater = start + 24 * 60 * 60 * 1000;
  const claim = claimStakeRewards(state, wallet, oneDayLater);
  assert.equal(claim.claimed, 400 * SOFT_STAKE_APR_DAILY);
  assert.equal(player.points, 620);
  assert.equal(player.staked, 400);

  const unstake = unstakePoints(state, wallet, 100, oneDayLater);
  assert.equal(unstake.unstaked, 100);
  assert.equal(player.points, 720);
  assert.equal(player.staked, 300);
});

test("stake rejects invalid amounts and insufficient balances", () => {
  const wallet = "0x2222222222222222222222222222222222222222";
  const state = createPredictionState();
  ensurePlayer(state, wallet).points = 10;

  assert.equal(stakePoints(state, wallet, 0).status, 400);
  assert.equal(stakePoints(state, wallet, 11).status, 400);
  assert.equal(unstakePoints(state, wallet, 1).status, 400);
});

test("wallet authorization verifies the signer and expires", async () => {
  const signer = Wallet.createRandom();
  const wallet = signer.address.toLowerCase();
  const issuedAt = Date.UTC(2026, 7, 31, 10, 0, 0);
  const signature = await signer.signMessage(buildStakeAuthMessage(wallet, issuedAt));

  assert.equal(
    verifyStakeAuthorization({ wallet, signature, issuedAt }, issuedAt + 1_000).ok,
    true
  );
  assert.equal(
    verifyStakeAuthorization(
      { wallet: "0x3333333333333333333333333333333333333333", signature, issuedAt },
      issuedAt + 1_000
    ).status,
    401
  );
  assert.match(
    verifyStakeAuthorization(
      { wallet, signature, issuedAt },
      issuedAt + STAKE_AUTH_TTL_MS + 1
    ).error,
    /expired/
  );
});
