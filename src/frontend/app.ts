import bodyParser from 'body-parser';
import express, {Express, NextFunction, Request, Response} from 'express';
import path from 'path';
import cookieSession from 'cookie-session';
import csrf from 'csurf';
import Sentry, {Scope} from '@sentry/node';
import hbs from 'hbs';
import GithubOauth from './github-oauth';
import getGitHubSetup from './get-github-setup';
import postGitHubSetup from './post-github-setup';
import getGitHubConfiguration from './get-github-configuration';
import postGitHubConfiguration from './post-github-configuration';
import listGitHubInstallations from './list-github-installations';
import getGitHubSubscriptions from './get-github-subscriptions';
import deleteGitHubSubscription from './delete-github-subscription';
import getJiraConfiguration from './get-jira-configuration';
import deleteJiraConfiguration from './delete-jira-configuration';
import getGithubClientMiddleware from './github-client-middleware';
import verifyJiraMiddleware from './verify-jira-middleware';
import retrySync from './retry-sync';
import api from '../api';
import logMiddleware from '../middleware/log-middleware';
import {App} from '@octokit/app';

// Adding session information to request
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session: {
        jiraHost?: string;
        githubToken?: string;
        [key: string]: unknown;
      };
    }
  }
}

const oauth = GithubOauth({
  githubClient: process.env.GITHUB_CLIENT_ID,
  githubSecret: process.env.GITHUB_CLIENT_SECRET,
  baseURL: process.env.APP_URL,
  loginURI: '/github/login',
  callbackURI: '/github/callback',
});

// setup route middlewares
const csrfProtection = csrf(
  process.env.NODE_ENV === 'test' ? {
    ignoreMethods: ['GET',
      'HEAD',
      'OPTIONS',
      'POST',
      'PUT'],
  } : undefined,
);

export default (octokitApp: App): Express => {
  const githubClientMiddleware = getGithubClientMiddleware(octokitApp);

  const app = express();
  const rootPath = path.resolve(__dirname, '..', '..');

  // The request handler must be the first middleware on the app
  app.use(Sentry.Handlers.requestHandler());

  // Parse URL-encoded bodies for Jira configuration requests
  app.use(bodyParser.urlencoded({extended: false}));

  // We run behind ngrok.io so we need to trust the proxy always
  app.set('trust proxy', true);

  app.use(cookieSession({
    keys: [process.env.GITHUB_CLIENT_SECRET],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    signed: true,
    sameSite: 'none',
    secure: true,
  }));

  app.use(logMiddleware);

  // TODO: move all view/static/public/handlebars helper things in it's own folder
  app.set('view engine', 'hbs');
  app.set('views', path.join(rootPath, 'views'));

  // Handlebars helpers
  hbs.registerHelper('toLowerCase', (str) => str.toLowerCase());
  hbs.registerHelper('replaceSpaceWithHyphen', (str) => str.replace(/ /g, '-'));
  hbs.registerHelper('ifAllReposSynced', (numberOfSyncedRepos, totalNumberOfRepos) =>
    ((numberOfSyncedRepos === totalNumberOfRepos) ? totalNumberOfRepos : `${numberOfSyncedRepos} / ${totalNumberOfRepos}`));

  app.use('/public', express.static(path.join(rootPath, 'static')));
  app.use('/public/css-reset', express.static(path.join(rootPath, 'node_modules/@atlaskit/css-reset/dist')));
  app.use('/public/primer', express.static(path.join(rootPath, 'node_modules/primer/build')));
  app.use('/public/atlassian-ui-kit', express.static(path.join(rootPath, 'node_modules/@atlaskit/reduced-ui-pack/dist')));

  // Check to see if jira host has been passed to any routes and save it to session
  app.use((req: Request, _: Response, next: NextFunction): void => {
    req.session.jiraHost = req.query.xdm_e as string || req.session.jiraHost;
    next();
  });

  app.use(githubClientMiddleware);

  app.use('/api', api);

  app.get('/github/setup', csrfProtection, oauth.checkGithubAuth, getGitHubSetup);
  app.post('/github/setup', csrfProtection, postGitHubSetup);

  app.get('/github/configuration', csrfProtection, oauth.checkGithubAuth, getGitHubConfiguration);
  app.post('/github/configuration', csrfProtection, postGitHubConfiguration);

  app.get('/github/installations', csrfProtection, oauth.checkGithubAuth, listGitHubInstallations);
  app.get('/github/subscriptions/:installationId', csrfProtection, getGitHubSubscriptions);
  app.post('/github/subscription', csrfProtection, deleteGitHubSubscription);

  app.get('/jira/configuration', csrfProtection, verifyJiraMiddleware, getJiraConfiguration);
  app.delete('/jira/configuration', verifyJiraMiddleware, deleteJiraConfiguration);
  app.post('/jira/sync', verifyJiraMiddleware, retrySync);

  app.get('/', async (_:Request, res:Response, next:NextFunction) => {
    const {data: info} = (await res.locals.client.apps.getAuthenticated({}));
    res.redirect(info.external_url);
    next();
  });

  // Add Sentry Context
  app.use((err: Error, req: Request, _: Response, next: NextFunction) => {
    Sentry.withScope((scope: Scope): void => {
      if (req.session.jiraHost) {
        scope.setTag('jiraHost', req.session.jiraHost);
      }

      if (req.body) {
        Sentry.setExtra('Body', req.body);
      }

      next(err);
    });
  });
  // The error handler must come after controllers and before other error middleware
  app.use(Sentry.Handlers.errorHandler());

  oauth.addRoutes(app);

  // Error catcher - Batter up!
  app.use((err: Error, _: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'development') {
      return next(err);
    }

    // TODO: move this somewhere else, enum?
    const errorCodes = {
      Unauthorized: 401,
      Forbidden: 403,
      'Not Found': 404,
    };

    return res
      .status(errorCodes[err.message] || 400)
      .render('github-error.hbs', {
        title: 'GitHub + Jira integration',
      });
  });

  return app;
};