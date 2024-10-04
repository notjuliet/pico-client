import {
  createSignal,
  For,
  onMount,
  Show,
  untrack,
  type Component,
} from "solid-js";
import { WebSocket } from "partysocket";

import {
  BrowserOAuthClient,
  OAuthSession,
} from "@atproto/oauth-client-browser";
import "@atcute/bluesky/lexicons";
import { XRPC } from "@atcute/client";
import { SocialPskyFeedPost } from "@atcute/client/lexicons";
import * as TID from "@atcute/tid";

const CHARLIMIT = 64;
const MAXPOSTS = 100;
const SERVER_URL = "pico.api.bsky.mom";

type PostRecord = {
  uri: string;
  post: string;
  handle: string;
  indexedAt: number;
};

let unreadCount = 0;
const [loginState, setLoginState] = createSignal(false);
let rpc: XRPC;
let session: OAuthSession;

const resolveDid = async (did: string) => {
  const res = await fetch(
    did.startsWith("did:web") ?
      `https://${did.split(":")[2]}/.well-known/did.json`
    : "https://plc.directory/" + did,
  );

  return res.json().then((doc) => {
    for (const alias of doc.alsoKnownAs) {
      if (alias.includes("at://")) {
        return alias.split("//")[1];
      }
    }
  });
};

const Login: Component = () => {
  const [loginInput, setLoginInput] = createSignal("");
  const [handle, setHandle] = createSignal("");
  const [notice, setNotice] = createSignal("");
  let client: BrowserOAuthClient;

  onMount(async () => {
    setNotice("Loading...");
    client = new BrowserOAuthClient({
      clientMetadata: undefined,
      handleResolver: "https://boletus.us-west.host.bsky.network",
    });

    client.addEventListener("deleted", () => {
      setLoginState(false);
    });
    const result = await client.init().catch(() => {});

    if (result) {
      session = result.session;
      rpc = new XRPC({
        handler: { handle: session.fetchHandler.bind(session) },
      });
      setLoginState(true);
      setHandle(await resolveDid(session.did));
    }
    setNotice("");
  });

  const loginBsky = async (handle: string) => {
    setNotice("Redirecting...");
    try {
      await client.signIn(handle, {
        scope: "atproto transition:generic",
        signal: new AbortController().signal,
      });
    } catch (err) {
      setNotice("Error during OAuth redirection");
    }
  };

  const logoutBsky = async () => {
    if (session.sub) await client.revoke(session.sub);
  };

  return (
    <div class="mb-4 flex flex-col items-center text-sm">
      <Show when={!loginState() && !notice().includes("Loading")}>
        <form class="flex items-center" onsubmit={(e) => e.preventDefault()}>
          <label for="handle" class="mr-2">
            Handle:
          </label>
          <input
            type="text"
            id="handle"
            placeholder="user.bsky.social"
            class="mr-2 w-52 border border-black px-2 py-1 dark:border-white dark:bg-neutral-700 sm:w-72"
            onInput={(e) => setLoginInput(e.currentTarget.value)}
          />
          <button
            onclick={() => loginBsky(loginInput())}
            class="bg-stone-600 px-1 py-1 text-sm font-bold text-white hover:bg-stone-700"
          >
            Login
          </button>
        </form>
      </Show>
      <Show when={loginState() && handle()}>
        <div class="mb-3 text-xs">
          Logged in as @{handle()} (
          <a href="" class="text-red-500" onclick={() => logoutBsky()}>
            Logout
          </a>
          )
        </div>
      </Show>
      <Show when={notice()}>
        <div class="mt-3">{notice()}</div>
      </Show>
    </div>
  );
};

const PostFeed: Component = () => {
  const [posts, setPosts] = createSignal<PostRecord[]>([]);
  const socket = new WebSocket(`wss://${SERVER_URL}/subscribe`);

  onMount(() => {
    socket.addEventListener("open", async () => {
      setPosts(await getPosts());
    });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data) as PostRecord;
      setPosts([data, ...untrack(posts).slice(0, MAXPOSTS - 1)]);
      if (!document.hasFocus()) {
        unreadCount++;
        document.title = `(${unreadCount}) picosky`;
      }
    });
  });

  const getPosts = async () => {
    const res = await fetch(`https://${SERVER_URL}/posts?limit=${MAXPOSTS}`);
    return await res.json();
  };

  return (
    <div class="flex flex-col">
      <For each={posts()}>
        {(record) => (
          <span class="mb-0.5 flex items-center gap-x-3 border-b text-sm dark:border-b-neutral-800">
            <span class="flex w-[5.5rem] flex-col text-xs">
              <a
                target="_blank"
                href={`https://bsky.app/profile/${record.handle}`}
                classList={{
                  "text-violet-600 dark:text-violet-400":
                    record.handle !== "psky.social",
                  "break-words text-stone-500 dark:text-stone-400": true,
                }}
              >
                {record.handle}{" "}
              </a>

              <span>{new Date(record.indexedAt).toLocaleTimeString()}</span>
            </span>
            <span class="max-h-40 w-60 overflow-hidden break-words font-sans sm:w-80">
              {record.post}
            </span>
          </span>
        )}
      </For>
      <p></p>
    </div>
  );
};

const PostComposer: Component = () => {
  const [saveToggle, setSaveToggle] = createSignal(false);
  const [firstChar, setFirstChar] = createSignal("");
  let postInput = "";
  const segmenter = new Intl.Segmenter();

  onMount(() => {
    setSaveToggle(
      localStorage.getItem("saveFirstChar") === "true" ? true : false,
    );

    setFirstChar(localStorage.getItem("firstChar") ?? "");
    const textInputElem = document.getElementById(
      "textInput",
    ) as HTMLInputElement;
    if (saveToggle() && firstChar()) {
      textInputElem.setAttribute("value", firstChar());
      textInputElem.value = firstChar();
    }
  });

  const graphemeLen = (text: string): number => {
    let iterator = segmenter.segment(text)[Symbol.iterator]();
    let count = 0;

    while (!iterator.next().done) count++;

    return count;
  };

  const sendPost = async (post: string) => {
    if (!loginState()) {
      await fetch(`https://${SERVER_URL}/post`, {
        method: "POST",
        body: JSON.stringify({ post: post }),
        headers: { "Content-Type": "application/json" },
      });
    } else {
      await rpc
        .call("com.atproto.repo.putRecord", {
          data: {
            repo: session.did,
            collection: "social.psky.feed.post",
            rkey: TID.now(),
            record: {
              $type: "social.psky.feed.post",
              text: post,
            } as SocialPskyFeedPost.Record,
          },
        })
        .catch((err) => console.log(err));
    }
  };

  return (
    <div class="mb-4 flex w-full justify-center">
      <div class="flex items-center">
        <input
          type="checkbox"
          id="saveChar"
          checked={saveToggle()}
          class="mr-2 accent-stone-600"
          onChange={(e) => {
            setSaveToggle(e.currentTarget.checked);
            localStorage.setItem(
              "saveFirstChar",
              saveToggle() ? "true" : "false",
            );
          }}
        />
        <label for="saveChar" class="w-10 text-xs">
          save char
        </label>
        <form
          id="postForm"
          onsubmit={(e) => {
            e.currentTarget.reset();
            e.preventDefault();
          }}
        >
          <input
            type="text"
            id="textInput"
            placeholder="64 chars max"
            required
            class="mr-2 w-52 border border-black px-2 py-1 font-sans dark:border-white dark:bg-neutral-700 sm:w-72"
            onInput={(e) => (postInput = e.currentTarget.value)}
            onPaste={(e) => {
              if (
                graphemeLen(e.clipboardData?.getData("text") ?? "") >= CHARLIMIT
              )
                e.preventDefault();
            }}
            onBeforeInput={(e) => {
              if (e.data && graphemeLen(postInput) >= CHARLIMIT)
                e.preventDefault();
            }}
          />
          <button
            onclick={() => {
              if (!postInput.length) return;
              sendPost(postInput);
              if (saveToggle()) {
                setFirstChar([...segmenter.segment(postInput)][0].segment);
                const textInputElem = document.getElementById(
                  "textInput",
                ) as HTMLInputElement;
                textInputElem.setAttribute("value", firstChar());
                textInputElem.value = firstChar();
                localStorage.setItem("firstChar", firstChar());
              }
              postInput = saveToggle() ? firstChar() : "";
            }}
            class="bg-stone-600 px-1 py-1 text-sm font-bold text-white hover:bg-stone-700"
          >
            pico
          </button>
        </form>
      </div>
    </div>
  );
};

const App: Component = () => {
  const [theme, setTheme] = createSignal("");

  onMount(() => {
    if (localStorage.theme !== undefined) setTheme(localStorage.theme);
    else setTheme("light");

    window.addEventListener("focus", () => {
      unreadCount = 0;
      document.title = "picosky";
    });
  });

  return (
    <div class="flex flex-col items-center py-4 font-mono dark:text-white">
      <div class="relative flex flex-col items-center">
        <h1 class="mb-2 text-xl">picosky</h1>
        <div class="absolute left-0 top-0 text-sm">
          <button
            onclick={() => {
              localStorage.theme =
                localStorage.theme === "light" || !localStorage.theme ?
                  "dark"
                : "light";
              if (localStorage.theme === "dark")
                document.documentElement.classList.add("dark");
              else document.documentElement.classList.remove("dark");
              setTheme(localStorage.theme);
            }}
          >
            {theme() == "dark" ? "light" : "dark"}
          </button>
        </div>
        <p class="text-xs">
          original idea by{" "}
          <a class="text-sky-500" href="https://bsky.app/profile/cam.fyi">
            @cam.fyi
          </a>
        </p>
        <p class="mb-3 text-xs">
          developed by{" "}
          <a class="text-sky-500" href="https://bsky.app/profile/bsky.mom">
            @bsky.mom
          </a>
        </p>
        <Login />
        <PostComposer />
        <PostFeed />
      </div>
    </div>
  );
};

export default App;
