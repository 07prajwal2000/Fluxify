# Fluxify Roadmap

This document outlines the priority features and milestones required to elevate Fluxify into a fully-fledged, production-ready REST API engine. Completing these features will pave the way for the upcoming **AI Agent Harness (Builder Mode)**.

## 1. Request Validation & Schemas
Ensuring that incoming data is structurally sound before any business logic is executed.
- **Schema Builder:** Visual interface to define schemas (e.g., using JSON Schema, Zod, or Joi) for Request Body, Query Parameters, and Headers.
- **Validation Logic:** Automatically reject invalid requests with `400 Bad Request` and structured error messages before they reach the main workflow execution.

## 2. Auto-Generated API Documentation
Crucial for any production API. 
- **OpenAPI / Swagger Generation:** Automatically generate and host a Swagger UI or Redoc portal. The documentation will be driven by the configured routes, inputs (from the Schema Builder), and outputs of the workflows.
- Use https://scalar.com/products/api-references/integrations/react to display the API documentation. Its more modern and interactive than Swagger UI or Redoc.

## 3. Versioning & API Grouping
Organizing and evolving APIs without breaking existing clients.
- **API Grouping & Versioning:** Native support for grouping APIs by a group object or prefix (e.g., `/api/v1/...`, `/api/users/...`).
- **Environment Management:** Staging vs. Production deployment profiles with environment-specific variables and secrets.

## 4. Dedicated Middlewares Section
A dedicated layer for request pre-processing and security.
- **JWT Middleware:** Dedicated UI and middleware section for JWT validation and issuance (replacing the purely programmatic approach).
- **API Key Management (Mandatory):** Generate, revoke, and manage API keys for machine-to-machine integrations.
- **Rate Limiters (Optional):** Optional Redis-backed or in-memory rate limiters to protect endpoints.
- **CORS Configuration (Optional):** Fine-grained Cross-Origin Resource Sharing settings.

## 5. Asynchronous Processing & Message Queues
Offloading heavy tasks and integrating with event-driven architectures.
- **Async Workflows (Mandatory):** Ability to trigger another Fluxify workflow asynchronously (fire-and-forget) and immediately return a `202 Accepted` to the client.
- **Message Queues Integrations (Very Important):** First-class integrations with RabbitMQ, Kafka, or AWS SQS.
- **Background Jobs:** Cron scheduling and execution (Currently WIP).

## 6. Server-Sent Events (SSE) & WebSockets
Real-time streaming capabilities.
- **SSE (Server-Sent Events):** Crucial for AI-specific workflows (e.g., streaming LLM responses back to the client).
- **WebSockets:** Bidirectional real-time communication support.

## 7. Caching Blocks
Performance optimizations within the visual builder.
- **Cache Blocks:** While caching integrations (e.g., Redis) already exist, specific drag-and-drop blocks for `Get Cache`, `Set Cache`, and `Invalidate Cache` need to be added to the workflow builder for ease of use.

## 8. File Handling & Storage (Future / Optional)
Since Fluxify is a pure REST API Engine, this is not a primary focus, but remains on the roadmap for extended use cases.
- **S3 API Integrations:** Blocks for handling file uploads and basic file management via S3-compatible APIs.
