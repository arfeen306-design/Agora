import { admissionStatusClass, admissionStatusLabel } from "./admission-utils";

interface AdmissionStatusPillProps {
  status: string;
}

export default function AdmissionStatusPill({ status }: AdmissionStatusPillProps) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${admissionStatusClass(status)}`}>
      {admissionStatusLabel(status)}
    </span>
  );
}
