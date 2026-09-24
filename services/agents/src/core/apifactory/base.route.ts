import { Router, type NextFunction, type Request, type Response } from "express";

type ControllerMethod = (req: Request, res: Response, next: NextFunction) => unknown;

export interface StandardRoute {
  httpAction: "get" | "post" | "put" | "patch" | "delete";
  suffix: string;
  controllerMethod: ControllerMethod;
}

export const ExtendLeadFlowRoutes = (routes: StandardRoute[]): Router => {
  const router = Router();

  routes.forEach((route) => {
    router[route.httpAction](
      route.suffix,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          await route.controllerMethod(req, res, next);
        } catch (error) {
          next(error);
        }
      },
    );
  });

  return router;
};
