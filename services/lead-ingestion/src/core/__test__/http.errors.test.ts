import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { ExternalHttpError, toExternalHttpError } from "#core/http/http.errors";

describe("toExternalHttpError", () => {
  const axiosError = () => {
    const config = {
      method: "get",
      url: "/oauth/access_token?code=SECRET_CODE",
      params: { client_secret: "APP_SECRET", fb_exchange_token: "USER_TOKEN" },
      headers: new AxiosHeaders({ "x-service-token": "SERVICE_TOKEN" }),
    };
    return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, {
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config,
      data: { error: { message: "Invalid verification code format.", code: 100, type: "OAuthException" } },
    });
  };

  it("keeps status, route and Graph error but none of the secrets", () => {
    const err = toExternalHttpError("Graph", axiosError());

    expect(err).toBeInstanceOf(ExternalHttpError);
    const e = err as ExternalHttpError;
    expect(e.status).toBe(400);
    expect(e.route).toBe("GET /oauth/access_token");
    expect(e.graphError).toMatchObject({ code: 100, type: "OAuthException" });

    const serialized = JSON.stringify({ ...e, message: e.message, stack: e.stack });
    for (const secret of ["SECRET_CODE", "APP_SECRET", "USER_TOKEN", "SERVICE_TOKEN"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(e.cause).toBeUndefined();
  });

  it("passes non-axios errors through untouched", () => {
    const plain = new Error("boom");
    expect(toExternalHttpError("Graph", plain)).toBe(plain);
  });
});
