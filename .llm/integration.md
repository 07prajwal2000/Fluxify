# Integration
An integration is a way to connect to external services from fluxify using [Blocks](blocks.md) or even in the application platform. 

## How to add a new integration
1. Make sure to gather required information from the user.
  - Required information can vary from integration to integration. But minimum it needs to have Group and Variant. Group is where many integrations of the same type are grouped. Variant is the specific integration. Refer [Schemas](apps\server\src\api\v1\integrations\schemas.ts) for more information.
2. For every integration, there will be a connection config. So it is required to define a schema for it and any other required information. Basically it is defined in the [Schemas](apps\server\src\api\v1\integrations\schemas.ts) using zod.
  - For any given property in the schema, if it requires app configuration, then it should start with `cfg:` prefix to make it available in the app to set the config at runtime. See other schemas for more information.
3. Then proceed to write the logic for the integration. Usually it is written in packages/adapters folder. And under it similar integrations are grouped in a folder. For example, if you are adding a new database integration, you can create a new folder under packages/adapters/db and write the logic there.
  - For any Logic, it should be a class with 2 static methods: TestConnection and ExtractConnectionInfo. TestConnection is used to test the connection to the external service. ExtractConnectionInfo is used to extract the connection info from the config. 
  - If there are more integrations with similar methods, extract the common logic into a base abstract class and extend it in the new integration.
4. Add the test logic in the [service](apps\server\src\api\v1\integrations\test-connection\service.ts) to make it available in the API for testing the connection. It should be put under proper group and variant.
  - And Also it is required to add the integration to be listed in the [loader](apps\server\src\loaders\integrationsLoader.ts) file for it to be available in the app.
5. Also the schema defined before should be made available in the [helper](apps\server\src\api\v1\integrations\helpers.ts) file for it to be used for validation.
6. For frontend UI, you are required to write proper zod validated form for the schema in this [folder](apps\web\src\components\forms) with properly grouped folder & file names. So refer few other forms in the folder for more information. 
  - After implementing the form, make sure to add it in the [integration.tsx](apps\web\src\components\forms\integration.tsx) file.
  - You are also required to ask which icon to use from the user for the integration which is being created. And map that icon to the integration in the [integrationIcons.tsx](apps\web\src\components\integrationIcons.tsx) file.
7. Write Integration tests for Databases/KV stores using test containers. For any other integrations, ask the user for proper instructions on how setup the dependencies & to write tests for it.
  - For setting up docker containers, use `Bun.$` shell commands to start and stop the containers. And give a name to container so it can be identified and stopped later. Once stopped, you are also required to remove the container and cleanup any other resources created.
  - These tests should be written in files which ends with **.spec.ts
  - For mock data, use faker-js/faker library to generate dummy data. Link for the docs: https://fakerjs.dev/guide/