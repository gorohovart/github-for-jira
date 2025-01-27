import { Router } from "express";
import { JwtHandler } from "~/src/rest/middleware/jwt/jwt-handler";
import { OAuthRouter } from "~/src/rest/routes/oauth";
import { GitHubCallbackRoute } from "~/src/rest/routes/github-callback";
import { GitHubOrgsRouter } from "~/src/rest/routes/github-orgs";
import { GitHubTokenHandler } from "~/src/rest/middleware/jwt/github-token";
import { GitHubAppsRoute } from "./routes/github-apps";

export const RestRouter = Router({ mergeParams: true });

const subRouter = Router({ mergeParams: true });

/**
 * For cloud flow, the path will be `/rest/app/cloud/XXX`,
 * For enterprise flow, the path will be `/rest/app/SERVER-UUID/XXX`
 */
RestRouter.use("/app/:cloudOrUUID", subRouter);

subRouter.use("/github-callback", GitHubCallbackRoute);

subRouter.use(JwtHandler);

subRouter.use("/oauth", OAuthRouter);

subRouter.use("/installation", GitHubAppsRoute);

subRouter.use(GitHubTokenHandler);

subRouter.use("/org", GitHubOrgsRouter);

