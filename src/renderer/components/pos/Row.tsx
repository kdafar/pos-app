import React from 'react';

export default function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 ink-2">
      <span className="min-w-0">{label}</span>
      <span className="font-medium ink tabular-nums money">{value}</span>
    </div>
  );
}
