---
title: Licenses and Contributions
description: Which parts of Fluxify are Apache 2.0 and which are under the Enterprise Edition License, who can use each for free, and what contributing to each part means.
---

# Licenses and Contributions

Fluxify's code is under two licenses. Which one applies depends only on where
the code lives.

| Code | License | Short version |
| :--- | :--- | :--- |
| Any folder named `ee`, and any file with `.ee.` in its name (like `connector.ee.ts`) | Fluxify Enterprise Edition License | Source-available. Free for personal, education, and non-profit use. Commercial use needs a license key. |
| Everything else | Apache License 2.0 | Open source. Free for any use, including commercial. |

## Who can use what for free

| You are… | Community features | Enterprise features |
| :--- | :---: | :---: |
| An individual, on a personal project | ✅ Free | ✅ Free with `LICENSE_KEY=NON_COMMERCIAL` |
| A school, university, or student | ✅ Free | ✅ Free with `LICENSE_KEY=NON_COMMERCIAL` |
| A registered non-profit | ✅ Free | ✅ Free with `LICENSE_KEY=NON_COMMERCIAL` |
| A business, or anyone earning money from the deployment | ✅ Free | 🔑 Needs a license key |

::: tip Running Fluxify commercially without a key
You can run all of Fluxify commercially at no cost as long as the Enterprise
features are off. Leave `LICENSE_KEY` unset and you are on the Community
edition, which is entirely Apache 2.0.
:::

Everyone may read, modify, and test the Enterprise code for free. The license
key only matters once you use Enterprise features for real work. See
[Editions](/deployments/editions) for how to set it.

## What the Enterprise license does not allow

- Removing or bypassing the license check.
- Reselling the Enterprise features, or offering them to others as a hosted
  service.
- Removing copyright or license notices.

## Contributing

Every contribution is covered by the Fluxify Contributor License Agreement.
There is nothing to sign: opening a pull request is your acceptance.

| | Contributing to Apache 2.0 code | Contributing to Enterprise code |
| :--- | :---: | :---: |
| You keep copyright of your work | ✅ | ✅ |
| Your change is released as open source | ✅ Apache 2.0 | ❌ Enterprise license |
| Fluxify may use, relicense, and sell your change without asking or paying you | ✅ | ✅ |

::: warning Contributing to Enterprise code
When you change a file in an `ee` folder or a `.ee.` file, your change becomes
part of the Enterprise edition. Fluxify's owner, and any company later formed
to run Fluxify, gets full rights to use and sell it, without asking you and
without paying you. If you'd rather your work stay open source, keep it
outside Enterprise code.
:::

The full texts are in the repository:
[LICENSE](https://github.com/fluxify-rest/Fluxify/blob/main/LICENSE),
[LICENSE_EE](https://github.com/fluxify-rest/Fluxify/blob/main/LICENSE_EE), and
[CLA.md](https://github.com/fluxify-rest/Fluxify/blob/main/CLA.md).
