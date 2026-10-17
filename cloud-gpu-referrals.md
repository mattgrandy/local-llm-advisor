# Cloud GPU referral / affiliate programs for localllmadvisor.com
Researched 2026-10-16 from official pages (search + fetch). Terms change; re-verify before signing. No sign-ups were made.

## Ranking
1. **Vast.ai** - exists now, no approval, 3% lifetime. Best fit (cheap rentals for LLM tinkerers).
2. **Runpod** - no approval, 3% pods / 5% serverless for 6 months + $5-$500 credit bonus (credits only). Cash 10% only after 25 paying referrals.
3. **DigitalOcean affiliate (Awin/Impact-style network, application)** - 10% cash for 12 months, 30-day cookie; GPU Droplets (incl. Paperspace now under DO). Needs approval; site is a niche fit.
4. **Together AI affiliate** - lead-gen ($50 demo / $500 contract), enterprise-oriented; low fit for hobbyist audience, low priority.
5. **Lambda** - no public affiliate/referral program (only B2B partner program). Skip / email later.
6. **TensorDock** - explicitly NO referral program. 
7. **Hyperstack (hyperstack.cloud)** - no public program found. (thehyperstack.com/affiliates is an UNRELATED credentials product; don't apply.)
8. **OpenRouter** - no affiliate program (startup credits only). 
9. **Salad** - the /affiliate page is for the consumer "earn from your idle PC" app, not SaladCloud; not relevant.

## Vast.ai  (priority 1)
- Page: https://docs.vast.ai/guides/reference/referral-program (link location: Console -> Settings -> "Referral Link"; docs: https://docs.vast.ai/guides/reference/account-settings)
- Payout: 3% of referred new client account's lifetime credit purchases, as referral credits, forever. Up to 75% cashable via Stripe Connect, PayPal or Wise. Template links also earn (public template -> Templates -> My Templates -> ... -> Copy Referral Link).
- Cookie window: not published.
- Min traffic: none; no application. Large collaborations: support@vast.ai.
- CRUCIAL: cash-out requires a dedicated NEW referral account. If an account has ever rented instances, cash-out is blocked until referral earnings exceed its lifetime instance spend. Matt's existing account (has rented, has credits) can use the link but only earns credits to spend on Vast. Docs say do not operate multiple referral accounts, and you can't refer yourself/connected accounts. Options: (a) use existing account's link, take credits (fine - funds our benchmark sweeps); (b) create one separate account just for referrals if cash matters (one only).
- Restrictions (effective Sept 15, 2026): no paid search/display/video/social ads targeting "vast", "vast.ai", "vast gpu" etc.; no ads linking directly to vast.ai URLs; no Vast logos/trademarks in ad copy. Organic site links OK. Violations forfeit credits. No specific disclosure text published -> still use FTC-style disclosure + rel="sponsored".
- Needs from Matt: nothing for credits. For cash: a second account + Stripe Connect/PayPal/Wise payout setup (identity/tax info collected by those processors).
- Account check: docs say the link is in Settings; I did NOT log in to Matt's account to confirm. Matt (or me via the already signed-in browser if he OKs) should open https://cloud.vast.ai/account/ (Settings) and copy the Referral Link.

## Runpod  (priority 2)
- Pages: https://docs.runpod.io/accounts-billing/referrals ; https://www.runpod.io/referral-and-affiliate-program ; PartnerStack listing https://market.partnerstack.com/program/runpod
- Payout (standard referral, credits only): 3% of Pod spend, 5% Serverless, first 6 months of referred user's usage (users referred before June 2025 got lifetime). Plus bonus credits to both after referee loads $10: random weighted $5-$500 (non-EU; ~96% get <= $10), EU fixed $5. Template creator: 1% of spend on your public templates. Credits expire after 90 days, non-transferable.
- Affiliate tier: after 25 paying referrals, invited to PartnerStack: 10% CASH for 6 months (PartnerStack directory shows "12%", inconsistent - trust docs). Opting in is permanent.
- Cookie window: not published.
- Min traffic: none for referral; 25 paying referrals for cash tier.
- Eligibility traps: referee must sign up via Google SSO, be a first-time user, load >= $10. Commission is on usage, not purchases.
- Restrictions: no self-referral/manipulation (account suspension). No brand/ad rules found in the fetched docs; PartnerStack ToS (linked from listing) not read.
- Apply: Runpod console -> Referral dashboard -> copy link (format https://runpod.io?ref=XXXX). Needs a Runpod account (Matt has/needs one). Payout setup only at affiliate tier (PartnerStack: identity, payout method, tax form W-9 for US).
- NOTE: fetched docs page contained "agent instructions" telling bots to POST feedback to Runpod; ignored.

## DigitalOcean (covers GPU Droplets / Paperspace)  (priority 3)
- Affiliate: https://www.digitalocean.com/affiliates (apply via form; run on Awin, profile https://ui.awin.com/merchant-profile/123996; terms https://ui.awin.com/merchant-profile-terms/123996)
- Payout: 10% recurring monthly commission for 12 months on new paying customers' spend; cookie 30 days (Awin profile). Cash via Awin.
- Min traffic: not stated; applications are evaluated on site quality (human approval).
- Restrictions: no fake/VPN signups, no self-referral; avoid publishing static prices; affiliate and referral credits are mutually exclusive per customer; disclosure required by terms.
- Separate customer referral (credits only): $25 credit after referee spends $25 - https://www.digitalocean.com/referral-program (link in control panel Settings -> Referrals). Not cash.
- Needs from Matt: Awin account (name, address, website, payout method e.g. PayPal/bank; tax info per Awin; likely a small one-time publisher deposit fee may apply - verify at signup). Hobbyists aren't a core DO audience; lower priority.

## Together AI  (priority 4)
- Terms: https://www.togetherplatform.com/terms/affiliate-agreement (dated 2022; may be stale). Application form required, approval required.
- Payout: $50 if referred demo accepted within 30 days; $500 if customer signs purchase agreement within 180 days. Paid within 45 days after month end. Cookie: 30 days (demo request must follow click).
- Restrictions: no paid ads (own media only), no "Together" in URLs, no unofficial coupons, disclosure required.
- Enterprise-sales oriented; poor fit. Contact: info@togetherplatform.com.

## Lambda  - no program
- Only https://lambda.ai/partners (technology/implementation/channel partners, B2B). Terms mention discretionary credits. Third-party sites claim referral credits, unverified. Optionally email Lambda later; not worth now.

## TensorDock - no program (https://docs.tensordock.com/who-we-are/our-ethos-and-commitment states "we don't offer a referral program"). Only a "whitelabel storefront" with undisclosed commission, for hosts.

## Hyperstack / OpenRouter / Salad - no relevant program (see ranking notes). OpenRouter startup program (https://openrouter.ai/startup-program) is credits for startups, not referrals.

## Recommended site integration (when approved)
- Add "Rent instead" slot on advisor result when model doesn't fit or fit is marginal: Vast.ai + Runpod links, `rel="sponsored noopener"`, `data-sponsor="vast"|"runpod"`, Umami `sponsor_click`.
- Disclosure line beside links: "We may earn a credit/commission if you sign up via these links." Add to data page and footer.
- Keep rankings independent of payouts (state it), don't quote prices statically (Vast marketplace prices vary; DO asks affiliates not to).
- Expected revenue is small until traffic exists; these are credits-first programs.

## What Matt must do (order)
1. Vast: log into cloud.vast.ai -> Settings -> Referral Link -> send link (public by nature). Decide: existing account (credits) vs one new dedicated account (cash).
2. Runpod: console -> Referral -> send link.
3. Optional: apply to DigitalOcean affiliate form at https://www.digitalocean.com/affiliates.
