import { Bone } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-4 p-6" aria-busy="true" aria-label="Loading">
      <Bone className="h-6 w-40" />
      <Bone className="h-12 w-2/3" />
      <Bone className="ml-auto h-12 w-1/2" />
      <Bone className="h-12 w-3/5" />
    </div>
  );
}
