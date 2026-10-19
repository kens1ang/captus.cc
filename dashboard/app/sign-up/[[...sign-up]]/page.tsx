import { SignUp } from "@clerk/nextjs";
import { BrandMark } from "@/components/BrandMark";

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2.5">
        <BrandMark className="size-8" />
        <span className="text-lg font-semibold">Captus</span>
      </div>
      <SignUp />
    </div>
  );
}
