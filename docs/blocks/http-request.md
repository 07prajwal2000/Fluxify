---
title: HTTP Request
description: Send an HTTP request to an external server.
---

# HTTP Request

The **HTTP Request** block enables your application to communicate with other web services. You can send data to or fetch data from external APIs.

## Inputs

- **URL**: The web address of the external service. You can use JavaScript to construct this dynamically.
- **Method**: The type of request (GET, POST, PUT, DELETE, PATCH).
- **Headers**: Custom information sent with the request (like authentication tokens).
- **Body**: The data being sent to the server (for POST, PUT, PATCH).
- **Use Param**: If enabled, the block uses data passed from the previous block as the request body.

## Logic

1.  The block constructs the request using the provided **URL**, **Method**, **Headers**, and **Body**.
2.  It sends the request to the external server.
3.  It waits for a response.
4.  The response (including status and data) becomes the output of this block.
5.  If the request fails, the error details are output instead.
