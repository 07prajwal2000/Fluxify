import { afterAll } from "bun:test";
import { stopEngines } from "./engines";

/**
 * Preloaded into every test file, so the containers the suite shares are torn
 * down exactly once, after the last file finishes. Nothing starts them here — an
 * engine no fixture asks for is never launched.
 */
afterAll(stopEngines);
