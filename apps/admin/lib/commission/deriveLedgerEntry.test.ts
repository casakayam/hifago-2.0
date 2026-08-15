import { describe, expect, it } from "vitest";
import { deriveLedgerEntry } from "./deriveLedgerEntry";

// Snapshot externe réaliste (feature 11) : total=100000, acompte=17%(17000), référent=10%(10000),
// app=7%(7000) — providerShareCop structurel = 100000-17000 = 83000.
const SNAPSHOT = {
  commissionCase: "external_referrer",
  totalCop: 100000,
  acompteCop: 17000,
  referrerCommissionCop: 10000,
  appCommissionCop: 7000,
};

describe("deriveLedgerEntry", () => {
  it("reserved → estimated, montants structurels identiques à fulfilled", () => {
    expect(deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "reserved" })).toEqual({
      appDueCop: 7000,
      referrerDueCop: 10000,
      providerDueCop: 83000,
      state: "estimated",
    });
  });

  it("fulfilled → earned, providerDueCop = totalCop - acompteCop", () => {
    expect(deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "fulfilled" })).toEqual({
      appDueCop: 7000,
      referrerDueCop: 10000,
      providerDueCop: 83000,
      state: "earned",
    });
  });

  it("cancelled_by_client → redistributed, referrerDueCop tombe à 0, se retrouve intégralement dans providerDueCop", () => {
    const entry = deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "cancelled_by_client" });
    expect(entry).toEqual({
      appDueCop: 7000,
      referrerDueCop: 0,
      providerDueCop: 93000, // 83000 (part structurelle) + 10000 (commission référent redirigée)
      state: "redistributed",
    });
    // Conservation explicite : rien perdu, rien dupliqué — la somme des 3 parts reste égale à la
    // somme du snapshot d'origine (providerShareCop + referrerCommissionCop + appCommissionCop).
    expect(entry.referrerDueCop + entry.providerDueCop).toBe(83000 + 10000);
  });

  it("no_show → redistributed, même traitement que cancelled_by_client", () => {
    expect(deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "no_show" })).toEqual({
      appDueCop: 7000,
      referrerDueCop: 0,
      providerDueCop: 93000,
      state: "redistributed",
    });
  });

  it("expired → redistributed par analogie directe avec un no-show (extrapolation assumée)", () => {
    expect(deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "expired" })).toEqual({
      appDueCop: 7000,
      referrerDueCop: 0,
      providerDueCop: 93000,
      state: "redistributed",
    });
  });

  it("cancelled_by_provider → voided, tous les montants à 0 (aucune commission due)", () => {
    expect(deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "cancelled_by_provider" })).toEqual({
      appDueCop: 0,
      referrerDueCop: 0,
      providerDueCop: 0,
      state: "voided",
    });
  });

  it("conservation : appDueCop+referrerDueCop+providerDueCop égale toujours totalCop-0 pour earned/redistributed (rien n'est jamais créé ni perdu)", () => {
    const earned = deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "fulfilled" });
    const redistributed = deriveLedgerEntry({ ...SNAPSHOT, lineStatus: "cancelled_by_client" });
    const expectedTotal =
      SNAPSHOT.appCommissionCop + SNAPSHOT.referrerCommissionCop + (SNAPSHOT.totalCop - SNAPSHOT.acompteCop);
    expect(earned.appDueCop + earned.referrerDueCop + earned.providerDueCop).toBe(expectedTotal);
    expect(redistributed.appDueCop + redistributed.referrerDueCop + redistributed.providerDueCop).toBe(
      expectedTotal
    );
  });

  it("direct (referrerCommissionCop=0) : redistributed n'invente aucune part référent", () => {
    const directSnapshot = {
      commissionCase: "direct",
      totalCop: 50000,
      acompteCop: 8500,
      referrerCommissionCop: 0,
      appCommissionCop: 8500,
    };
    expect(deriveLedgerEntry({ ...directSnapshot, lineStatus: "cancelled_by_client" })).toEqual({
      appDueCop: 8500,
      referrerDueCop: 0,
      providerDueCop: 41500, // (50000-8500) + 0 : rien à rediriger, la part référent était déjà nulle
      state: "redistributed",
    });
  });
});
