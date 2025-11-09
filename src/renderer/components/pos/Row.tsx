import React from 'react';
import { useThemeTokens } from '../../hooks/useThemeTokens';

export default function Row({ label, value }: { label: string; value: string }) {
  const { t } = useThemeTokens();
  return (
    <div className={`flex justify-between ${t.textMuted}`}>
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
