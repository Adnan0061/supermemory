"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import {
	canvas,
	chatHistory,
	chatThreads,
	contentToSpace,
	space,
	spacesAccess,
	storedContent,
	users,
} from "@repo/db/schema";
import { ServerActionReturnType } from "./types";
import { auth } from "../../server/auth";
import { Tweet } from "react-tweet/api";
// import { getMetaData } from "@/lib/get-metadata";
import { and, eq, inArray, sql } from "drizzle-orm";
import { LIMITS } from "@repo/shared-types";
import { ChatHistory } from "@repo/shared-types";
import { decipher } from "@/server/encrypt";
import { redirect } from "next/navigation";
import { tweetToMd } from "@repo/shared-types/utils";
import { ensureAuth } from "../api/ensureAuth";
import { getRandomSentences } from "@/lib/utils";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const completeOnboarding = async (): ServerActionReturnType<boolean> => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	try {
		const res = await db
			.update(users)
			.set({ hasOnboarded: true })
			.where(eq(users.id, data.user.id))
			.returning({ hasOnboarded: users.hasOnboarded });

		if (res.length === 0 || !res[0]?.hasOnboarded) {
			return { success: false, data: false, error: "Failed to update user" };
		}

		return { success: true, data: res[0].hasOnboarded };
	} catch (e) {
		return { success: false, data: false, error: (e as Error).message };
	}
};

export const createSpace = async (
	input: string | FormData,
): ServerActionReturnType<number> => {
	const data = await auth();

	if (!data || !data.user) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	if (typeof input === "object") {
		input = (input as FormData).get("name") as string;
	}

	try {
		const resp = await db
			.insert(space)
			.values({ name: input, user: data.user.id, createdAt: new Date() });

		revalidatePath("/home");
		return { success: true, data: resp.meta.last_row_id };
	} catch (e: unknown) {
		const error = e as Error;
		if (
			error.message.includes("D1_ERROR: UNIQUE constraint failed: space.name")
		) {
			return { success: false, data: 0, error: "Space already exists" };
		} else {
			return {
				success: false,
				data: 0,
				error: "Failed to create space with error: " + error.message,
			};
		}
	}
};

const typeDecider = (content: string): "page" | "tweet" | "note" => {
	// if the content is a URL, then it's a page. if its a URL with https://x.com/user/status/123, then it's a tweet. else, it's a note.
	// do strict checking with regex
	if (content.match(/https?:\/\/(x\.com|twitter\.com)\/[\w]+\/[\w]+\/[\d]+/)) {
		return "tweet";
	} else if (
		content.match(
			/^(https?:\/\/)?(www\.)?[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,5}(\/.*)?$/i,
		)
	) {
		return "page";
	} else {
		return "note";
	}
};

export const addUserToSpace = async (userEmail: string, spaceId: number) => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	// We need to make sure that the user owns the space
	const spaceData = await db
		.select()
		.from(space)
		.where(and(eq(space.id, spaceId), eq(space.user, data.user.id)))
		.all();

	if (spaceData.length === 0) {
		return {
			success: false,
			error: "You do not own this space",
		};
	}

	try {
		await db.insert(spacesAccess).values({
			spaceId: spaceId,
			userEmail: userEmail,
		});

		revalidatePath("/space/" + spaceId);

		return {
			success: true,
		};
	} catch (e) {
		return {
			success: false,
			error: (e as Error).message,
		};
	}
};

const getTweetData = async (tweetID: string) => {
	const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetID}&lang=en&features=tfw_timeline_list%3A%3Btfw_follower_count_sunset%3Atrue%3Btfw_tweet_edit_backend%3Aon%3Btfw_refsrc_session%3Aon%3Btfw_fosnr_soft_interventions_enabled%3Aon%3Btfw_show_birdwatch_pivots_enabled%3Aon%3Btfw_show_business_verified_badge%3Aon%3Btfw_duplicate_scribes_to_settings%3Aon%3Btfw_use_profile_image_shape_enabled%3Aon%3Btfw_show_blue_verified_badge%3Aon%3Btfw_legacy_timeline_sunset%3Atrue%3Btfw_show_gov_verified_badge%3Aon%3Btfw_show_business_affiliate_badge%3Aon%3Btfw_tweet_edit_frontend%3Aon&token=4c2mmul6mnh`;

	const resp = await fetch(url, {
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
			Accept: "application/json",
			"Accept-Language": "en-US,en;q=0.5",
			"Accept-Encoding": "gzip, deflate, br",
			Connection: "keep-alive",
			"Upgrade-Insecure-Requests": "1",
			"Cache-Control": "max-age=0",
			TE: "Trailers",
		},
	});
	console.log(resp.status);
	const data = (await resp.json()) as Tweet;

	return data;
};

export const deleteSpace = async (id: number) => {
	try {
		await db.delete(space).where(eq(space.id, id));
		return {
			success: true,
		};
	} catch (e) {
		console.log(e);
	}
};

export const createMemory = async (input: {
	content: string;
	spaces?: number[];
}): ServerActionReturnType<number> => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	// make the backend reqeust for the queue here
	const vectorSaveResponses = await fetch(
		`${process.env.BACKEND_BASE_URL}/api/add`,
		{
			method: "POST",
			body: JSON.stringify({
				url: input.content,
				spaces: input.spaces,
				user: data.user.id,
			}),
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + process.env.BACKEND_SECURITY_KEY,
			},
		},
	);
	const response = (await vectorSaveResponses.json()) as {
		status: string;
		message?: string;
	};

	if (response.status !== "ok") {
		return {
			success: false,
			data: 0,
			error: response.message,
		};
	}

	return {
		success: true,
		data: 1,
	};
};

export const createChatThread = async (
	firstMessage: string,
): ServerActionReturnType<string> => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	const thread = await db
		.insert(chatThreads)
		.values({
			firstMessage,
			userId: data.user.id,
		})
		.returning({ id: chatThreads.id })
		.execute();

	console.log(thread);

	if (!thread[0]) {
		return {
			success: false,
			error: "Failed to create chat thread",
		};
	}

	return { success: true, data: thread[0].id };
};

export const createChatObject = async (
	threadId: string,
	chatHistorySoFar: ChatHistory[],
): ServerActionReturnType<boolean> => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	const lastChat = chatHistorySoFar[chatHistorySoFar.length - 1];
	if (!lastChat) {
		return {
			success: false,
			data: false,
			error: "No chat object found",
		};
	}

	const saved = await db.insert(chatHistory).values({
		question: lastChat.question,
		answer: lastChat.answer.parts.map((part) => part.text).join(""),
		answerSources: JSON.stringify(lastChat.answer.sources),
		threadId,
		createdAt: new Date(),
	});

	if (!saved) {
		return {
			success: false,
			data: false,
			error: "Failed to save chat object",
		};
	}

	return {
		success: true,
		data: true,
	};
};

export const linkTelegramToUser = async (
	telegramUser: string,
): ServerActionReturnType<boolean> => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	const user = await db
		.update(users)
		.set({ telegramId: decipher(telegramUser) })
		.where(eq(users.id, data.user.id))
		.execute();

	if (!user) {
		return {
			success: false,
			data: false,
			error: "Failed to link telegram to user",
		};
	}

	return {
		success: true,
		data: true,
	};
};

export const deleteItem = async (id: number) => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	try {
		const deletedItem = await db
			.delete(storedContent)
			.where(eq(storedContent.id, id))
			.returning();

		if (!deletedItem) {
			return {
				success: false,
				error: "Failed to delete item",
			};
		}

		const actualUrl = deletedItem[0]?.url.split("#supermemory-user-")[0];

		console.log(
			"ACTUAL URL BADBAL;KFJDLKASJFLKDSJFLKDSJFKD LSFJSLKDJF :",
			actualUrl,
		);

		await fetch(`${process.env.BACKEND_BASE_URL}/api/delete`, {
			method: "POST",
			body: JSON.stringify({
				websiteUrl: actualUrl,
				user: data.user.id,
			}),
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + process.env.BACKEND_SECURITY_KEY,
			},
		});

		revalidatePath("/memories");

		return {
			success: true,
			message: "in-sync",
		};
	} catch (error) {
		return {
			success: false,
			error,
			message: "An error occured while saving your canvas",
		};
	}
};

// TODO: also move in vectorize
export const moveItem = async (
	id: number,
	spaces: number[],
	fromSpace?: number | undefined,
): ServerActionReturnType<boolean> => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	try {
		if (fromSpace) {
			await db
				.delete(contentToSpace)
				.where(
					and(
						eq(contentToSpace.contentId, id),
						eq(contentToSpace.spaceId, fromSpace),
					),
				);
		}

		const addedItem = await db
			.insert(contentToSpace)
			.values(spaces.map((spaceId) => ({ contentId: id, spaceId })))
			.returning();

		if (!(addedItem.length > 0)) {
			return {
				success: false,
				error: "Failed to move item",
			};
		}

		await db
			.update(space)
			.set({ numItems: sql<number>`numItems + 1` })
			.where(eq(space.id, addedItem[0]?.spaceId!));

		if (!addedItem) {
			return {
				success: false,
				error: "Failed to move item",
			};
		}

		revalidatePath("/memories");

		return {
			success: true,
			data: true,
		};
	} catch (error) {
		return {
			success: false,
			error: (error as Error).message,
		};
	}
};

export const createCanvas = async () => {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	const canvases = await db
		.select()
		.from(canvas)
		.where(eq(canvas.userId, data.user.id));

	if (canvases.length >= 5) {
		return {
			success: false,
			message: "A user currently can only have 5 canvases",
		};
	}

	const resp = await db
		.insert(canvas)
		.values({ userId: data.user.id })
		.returning({ id: canvas.id });
	redirect(`/thinkpad/${resp[0]!.id}`);
	// TODO INVESTIGATE: NO REDIRECT INSIDE TRY CATCH BLOCK
	// try {
	//   const resp = await db
	//     .insert(canvas)
	//     .values({ userId: data.user.id }).returning({id: canvas.id});
	//   return redirect(`/canvas/${resp[0]!.id}`);
	// } catch (e: unknown) {
	//   const error = e as Error;
	//   if (
	//     error.message.includes("D1_ERROR: UNIQUE constraint failed: space.name")
	//   ) {
	//     return { success: false, data: 0, error: "Space already exists" };
	//   } else {
	//     return {
	//       success: false,
	//       data: 0,
	//       error: "Failed to create space with error: " + error.message,
	//     };
	//   }
	// }
};

export const SaveCanvas = async ({
	id,
	data,
}: {
	id: string;
	data: string;
}) => {
	console.log({ id, data });
	try {
		await process.env.CANVAS_SNAPS.put(id, data);
		return {
			success: true,
			message: "in-sync",
		};
	} catch (error) {
		return {
			success: false,
			error,
			message: "An error occured while saving your canvas",
		};
	}
};

export const deleteCanvas = async (id: string) => {
	try {
		await process.env.CANVAS_SNAPS.delete(id);
		await db.delete(canvas).where(eq(canvas.id, id));
		return {
			success: true,
			message: "in-sync",
		};
	} catch (error) {
		return {
			success: false,
			error,
			message: "An error occured while saving your canvas",
		};
	}
};

export async function AddCanvasInfo({
	id,
	title,
	description,
}: {
	id: string;
	title: string;
	description: string;
}) {
	try {
		await db
			.update(canvas)
			.set({ description, title })
			.where(eq(canvas.id, id));
		return {
			success: true,
			message: "info updated successfully",
		};
	} catch (error) {
		return {
			success: false,
			message: "something went wrong :/",
		};
	}
}

export async function getQuerySuggestions() {
	const data = await auth();

	if (!data || !data.user || !data.user.id) {
		redirect("/signin");
		return { error: "Not authenticated", success: false };
	}

	const { env } = getRequestContext();

	try {
		const recommendations = await env.RECOMMENDATIONS.get(data.user.id);

		if (recommendations) {
			return {
				success: true,
				data: JSON.parse(recommendations),
			};
		}

		// Randomly choose some storedContent of the user.
		const content = await db
			.select()
			.from(storedContent)
			.where(eq(storedContent.userId, data.user.id))
			.orderBy(sql`random()`)
			.limit(5)
			.all();

		if (content.length === 0) {
			return {
				success: true,
				data: [],
			};
		}

		const fullQuery = (
			content?.map((c) => `${c.title} \n\n${c.content}`) ?? []
		).join(" ");

		const suggestionsCall = (await env.AI.run(
			// @ts-ignore
			"@cf/meta/llama-3.1-8b-instruct",
			{
				messages: [
					{
						role: "system",
						content: `You are a model that suggests questions based on the user's content. you MUST suggest atleast 1 question to ask. AT MAX, create 3 suggestions. not more than that.`,
					},
					{
						role: "user",
						content: `Run the function based on this input: ${fullQuery.slice(0, 2000)}`,
					},
				],
				tools: [
					{
						type: "function",
						function: {
							name: "querySuggestions",
							description:
								"Take the user's content to suggest some good questions that they could ask.",
							parameters: {
								type: "object",
								properties: {
									querySuggestions: {
										type: "array",
										description:
											"Short questions that the user can ask. Give atleast 3 suggestions. No more than 5.",
										items: {
											type: "string",
										},
									},
								},
								required: ["querySuggestions"],
							},
						},
					},
				],
			},
		)) as {
			response: string;
			tool_calls: { name: string; arguments: { querySuggestions: string[] } }[];
		};

		console.log(
			"I RAN AN AI CALLS OWOWOWOWOW",
			JSON.stringify(suggestionsCall, null, 2),
		);

		const suggestions =
			suggestionsCall.tool_calls?.[0]?.arguments?.querySuggestions;

		if (!suggestions || suggestions.length === 0) {
			return {
				success: false,
				error: "Failed to get query suggestions",
			};
		}

		if (suggestions.length > 0) {
			await env.RECOMMENDATIONS.put(data.user.id, JSON.stringify(suggestions), {
				expirationTtl: 60 * 2,
			});
		}

		return {
			success: true,
			data: suggestions,
		};
	} catch (exception) {
		const error = exception as Error;
		return {
			success: false,
			error: error.message,
			data: [],
		};
	}
}
