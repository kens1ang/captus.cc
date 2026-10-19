import { SignIn } from "@clerk/nextjs";
import { BrandMark } from "@/components/BrandMark";

/** Logo + Clerk sign-in card. `hashRouting` lets it render on a path other than /sign-in. */
export function SignInScreen({ hashRouting }: { hashRouting?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2.5">
        <BrandMark className="size-8" />
        <span className="text-lg font-semibold">Captus</span>
      </div>
      {hashRouting ? <SignIn routing="hash" /> : <SignIn />}
    </div>
  );
}
