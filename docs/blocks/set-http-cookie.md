---
title: Set HTTP Cookie
description: Send a cookie back to the user's browser.
---

# Set HTTP Cookie

The **Set HTTP Cookie** block creates or updates a cookie in the user's browser.

## Inputs

- **Name**: The name of the cookie.
- **Value**: The data to store in the cookie.
- **Domain**: The website domain the cookie belongs to.
- **Path**: The URL path where the cookie is valid.
- **Expiry**: When the cookie should expire (date).
- **HttpOnly**: If true, the cookie cannot be accessed by client-side JavaScript (more secure).
- **Secure**: If true, the cookie is only sent over HTTPS.
- **SameSite**: Controls when cookies are sent with cross-site requests.

## Logic

1.  The block constructs a cookie with the provided settings.
2.  It attaches this cookie to the outgoing HTTP response.
