import { Response } from "express";

export type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
};

export function mockRes(): MockResponse {
  const res = {} as MockResponse;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

export function mockReq(overrides: Record<string, any> = {}) {
  const { headers: headerOverrides, ...rest } = overrides;
  const headers = { ...(headerOverrides ?? {}) };
  return {
    body: {},
    params: {},
    query: {},
    ip: "127.0.0.1",
    header(name: string) {
      return headers[name] ?? headers[name.toLowerCase()];
    },
    get(name: string) {
      return headers[name] ?? headers[name.toLowerCase()];
    },
    ...rest,
    headers,
  };
}
