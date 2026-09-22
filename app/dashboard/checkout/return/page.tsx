import CheckoutReturnView from "./ReturnView";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function CheckoutReturnPage({ searchParams }: Props) {
  const sp = await searchParams;

  const read = (key: string): string | undefined => {
    const value = sp[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return (
    <CheckoutReturnView
      initialStatus={read("status")}
      txRef={read("tx_ref")}
      transactionId={read("transaction_id")}
    />
  );
}