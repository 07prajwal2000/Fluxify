import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import { canAccess, canAccessProject, roleHierarchy } from "../../lib/acl";
import { AccessControlRole, AuthACL } from "../../db/schema";

describe("ACL (Access Control)", () => {
  describe("roleHierarchy", () => {
    it("should have correct hierarchy ordering", () => {
      expect(roleHierarchy.system_admin).toBeGreaterThan(
        roleHierarchy.project_admin,
      );
      expect(roleHierarchy.project_admin).toBeGreaterThan(
        roleHierarchy.creator,
      );
      expect(roleHierarchy.creator).toBeGreaterThan(roleHierarchy.viewer);
      expect(roleHierarchy.viewer).toBe(0);
    });
  });

  describe("canAccess()", () => {
    it("should grant access when role matches required role", () => {
      expect(canAccess("creator", "creator")).toBe(true);
    });

    it("should grant access when role exceeds required role", () => {
      expect(canAccess("system_admin", "viewer")).toBe(true);
      expect(canAccess("project_admin", "creator")).toBe(true);
    });

    it("should deny access when role is below required role", () => {
      expect(canAccess("viewer", "creator")).toBe(false);
      expect(canAccess("creator", "project_admin")).toBe(false);
    });

    it("should work with ACL array input", () => {
      const acl: AuthACL[] = [{ projectId: "proj-1", role: "creator" }];
      expect(canAccess(acl, "creator")).toBe(true);
      expect(canAccess(acl, "viewer")).toBe(true);
      expect(canAccess(acl, "project_admin")).toBe(false);
    });
  });

  describe("canAccessProject()", () => {
    it("should grant access for matching project and sufficient role", () => {
      const acl: AuthACL[] = [{ projectId: "proj-1", role: "creator" }];
      expect(canAccessProject(acl, "proj-1", "creator")).toBe(true);
      expect(canAccessProject(acl, "proj-1", "viewer")).toBe(true);
    });

    it("should deny access for wrong project", () => {
      const acl: AuthACL[] = [{ projectId: "proj-1", role: "creator" }];
      expect(canAccessProject(acl, "proj-2", "creator")).toBe(false);
    });

    it("should grant access for wildcard project (*)", () => {
      const acl: AuthACL[] = [{ projectId: "*", role: "creator" }];
      expect(canAccessProject(acl, "any-project", "creator")).toBe(true);
    });

    it("should grant access for system admin user", () => {
      const acl: AuthACL[] = [];
      const userData = {
        id: "user-1",
        name: "Admin",
        email: "admin@test.com",
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true,
        isSystemAdmin: true,
        image: null,
      };
      expect(
        canAccessProject(acl, "any-project", "system_admin", userData),
      ).toBe(true);
    });

    it("should deny access when role is insufficient for the project", () => {
      const acl: AuthACL[] = [{ projectId: "proj-1", role: "viewer" }];
      expect(canAccessProject(acl, "proj-1", "creator")).toBe(false);
    });
  });
});
