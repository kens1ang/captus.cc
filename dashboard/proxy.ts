import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// "/" is public so crawlers (e.g. Meta's domain verification, which reads the
// meta tag from the home page) get a 200 page instead of an auth 404. The
// page itself shows the sign-in card to signed-out visitors.
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

export const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
