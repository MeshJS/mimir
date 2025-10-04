import { metaAiken } from "./links-aiken";
import { metaHydra } from "./links-hydra";
import { metaMidnight } from "./links-midnight";
import { metaProviders } from "./links-providers";
import { metaReact } from "./links-react";
import { metaSmartContract } from "./links-smart-contracts";
import { metaSvelte } from "./links-svelte";
import { metaTxbuilder } from "./links-txbuilders";
import { metaTxParser } from "./links-txparser";
import { metaUtilities } from "./links-utilities";
import { metaWallets } from "./links-wallets";
import { metaYaci } from "./links-yaci";

export const metaWeb3Wallet = {
  title: "Wallet as a Service",
  desc: "Access self-custodial wallet using social logins",
  link: "https://utxos.dev/wallet-as-a-service",
  icon: "icons/utxos-white.png",
  items: [
    {
      title: "Wallet as a Service",
      link: "https://utxos.dev/wallet-as-a-service",
    }
  ]
};

export const metaTransactionSponsorship = {
  title: "Transaction Sponsorship",
  desc: "Sponsor blockchain transaction fees for your users to eliminate friction.",
  link: "https://utxos.dev/transaction-sponsorship",
  icon: "icons/utxos-white.png"
}

export const linksApi = [
  metaWallets,
  metaTxbuilder,
  metaTxParser,
  metaProviders,
  metaUtilities,
  metaReact,
  metaSvelte,
  metaSmartContract,
  metaAiken,
  metaHydra,
  metaYaci,
  metaMidnight,
  metaWeb3Wallet,
  metaTransactionSponsorship
];
