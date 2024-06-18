"use client";

import { getAllUserMemoriesAndSpaces } from "@/app/actions/fetchers";
import { Space } from "@/app/actions/types";
import { Content } from "@/server/db/schema";
import { NextIcon, SearchIcon, UrlIcon } from "@repo/ui/icons";
import Image from "next/image";
import React, { useEffect, useState } from "react";

function Page() {
  const [filter, setFilter] = useState("All");
  const setFilterfn = (i: string) => setFilter(i);

  const [search, setSearch] = useState("");

  const [memoriesAndSpaces, setMemoriesAndSpaces] = useState<{
    memories: Content[];
    spaces: Space[];
  }>({ memories: [], spaces: [] });

  useEffect(() => {
    (async () => {
      const { success, data } = await getAllUserMemoriesAndSpaces();
      if (!success ?? !data) return;
      setMemoriesAndSpaces({ memories: data.memories, spaces: data.spaces });
    })();
  }, []);

  return (
    <div className="max-w-3xl min-w-3xl py-36 h-full flex mx-auto w-full flex-col gap-12">
      <h2 className="text-white w-full font-medium text-2xl text-left">
        My Memories
      </h2>

      <div className="flex flex-col gap-4">
        <div className="w-full relative">
          <input
            type="text"
            className=" w-full py-3 rounded-md text-lg pl-8 bg-[#1F2428] outline-none"
            placeholder="search here..."
          />
          <Image
            className="absolute top-1/2 -translate-y-1/2 left-2"
            src={SearchIcon}
            alt="Search icon"
          />
        </div>

        <Filters filter={filter} setFilter={setFilterfn} />
      </div>
      <div>
        <div className="text-[#B3BCC5]">Spaces</div>
        {memoriesAndSpaces.spaces.map((space) => (
          <TabComponent title={space.name} description={space.id.toString()} />
        ))}
      </div>

      <div>
        <div className="text-[#B3BCC5]">Pages</div>
        {memoriesAndSpaces.memories.map((memory) => (
          <LinkComponent title={memory.title ?? "No title"} url={memory.url} />
        ))}
      </div>
    </div>
  );
}

function TabComponent({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center my-6">
      <div>
        <div className="h-12 w-12 bg-[#1F2428] flex justify-center items-center rounded-md">
          {title.slice(0, 2).toUpperCase()}
        </div>
      </div>
      <div className="grow px-4">
        <div className="text-lg text-[#fff]">{title}</div>
        <div>{description}</div>
      </div>
      <div>
        <Image src={NextIcon} alt="Search icon" />
      </div>
    </div>
  );
}

function LinkComponent({ title, url }: { title: string; url: string }) {
  return (
    <div className="flex items-center my-6">
      <div>
        <div className="h-12 w-12 bg-[#1F2428] flex justify-center items-center rounded-md">
          <Image src={UrlIcon} alt="Url icon" />
        </div>
      </div>
      <div className="grow px-4">
        <div className="text-lg text-[#fff]">{title}</div>
        <div>{url}</div>
      </div>
    </div>
  );
}

const FilterMethods = ["All", "Spaces", "Pages", "Notes"];
function Filters({
  setFilter,
  filter,
}: {
  setFilter: (i: string) => void;
  filter: string;
}) {
  return (
    <div className="flex gap-4">
      {FilterMethods.map((i) => {
        return (
          <div
            onClick={() => setFilter(i)}
            className={`transition px-6 py-2 rounded-xl  ${i === filter ? "bg-[#21303D] text-[#369DFD]" : "text-[#B3BCC5] bg-[#1F2428] hover:bg-[#1f262d] hover:text-[#76a3cc]"}`}
          >
            {i}
          </div>
        );
      })}
    </div>
  );
}

export default Page;
