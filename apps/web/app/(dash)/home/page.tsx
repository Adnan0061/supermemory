import React from "react";
import Menu from "../menu";
import Header from "../header";
import QueryInput from "./queryinput";
import { homeSearchParamsCache } from "@/lib/searchParams";
import { getSpaces } from "@/app/actions/fetchers";

async function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // TODO: use this to show a welcome page/modal
  const { firstTime } = homeSearchParamsCache.parse(searchParams);

  let spaces = await getSpaces();

  if (!spaces.success) {
    // TODO: handle this error properly.
    spaces.data = [];
  }

  return (
    <div className="max-w-3xl h-full justify-center flex mx-auto w-full flex-col">
      {/* all content goes here */}
      {/* <div className="">hi {firstTime ? 'first time' : ''}</div> */}

      <div className="w-full h-96">
        <QueryInput initialSpaces={spaces.data} />
      </div>
    </div>
  );
}

export default Page;
