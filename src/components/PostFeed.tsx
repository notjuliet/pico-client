import {
  Accessor,
  Component,
  createEffect,
  createSignal,
  For,
  onMount,
  Signal,
  untrack,
} from "solid-js";
import { PostRecord, DeleteEvent, UpdateEvent } from "../utils/types.js";
import { MAXPOSTS, SERVER_URL } from "../utils/constants.js";
import PostItem from "./PostItem.jsx";
import { loginState } from "./Login.jsx";
import { socket, UnreadState } from "../App.jsx";

interface PostFeedProps {
  unreadState: Accessor<UnreadState>;
  setUnreadState: (state: UnreadState) => void;
}
const PostFeed: Component<PostFeedProps> = ({
  unreadState,
  setUnreadState,
}) => {
  const [posts, setPosts] = createSignal<Signal<PostRecord>[]>([]);
  let cursor = 0;
  let feedSize = 100;

  const getPosts = async (updateCursor?: boolean) => {
    const res = await fetch(
      `https://${SERVER_URL}/posts?limit=${MAXPOSTS}&cursor=${cursor}`,
    );
    const json = await res.json();
    // HACK: force the cursor to only be updated after a first click
    // getPosts can be triggered twice in a row:
    // - when connecting to the websocket
    // - then when the handle is found, to refresh and highlight mentions
    // this would result in cursor getting updated, fetching older posts
    cursor = (updateCursor ?? true) ? json.cursor.toString() : "0";
    return json.posts.map((p: PostRecord) => createSignal<PostRecord>(p));
  };

  createEffect(async () => {
    if (loginState().handle) setPosts(await getPosts(false));
    window.scroll(0, document.body.scrollHeight);
  });

  onMount(() => {
    socket.addEventListener("open", async () => {
      setPosts(await getPosts(false));
      window.scroll(0, document.body.scrollHeight);
    });
    socket.addEventListener("message", (event) => {
      let data = JSON.parse(event.data);
      const [nsid, t] = data.$type.split("#");
      if (nsid !== "social.psky.feed.post") return;

      // TODO: Try to refactor this into proper functions
      switch (t) {
        case "create":
          let toScroll = false;
          if (
            window.innerHeight + window.scrollY + 100 >=
            document.body.scrollHeight
          )
            toScroll = true;

          setPosts([
            createSignal<PostRecord>(data as PostRecord),
            ...untrack(posts).slice(0, feedSize - 1),
          ]);

          const currUnreadState = unreadState();
          if (!document.hasFocus() || currUnreadState.count) {
            setUnreadState({
              ...currUnreadState,
              count: currUnreadState.count + 1,
            });
          }

          if (toScroll) window.scroll(0, document.body.scrollHeight);
          break;

        case "update":
          data = data as UpdateEvent;
          for (const p of posts()) {
            let post = p[0]();
            if (post.did === data.did && post.rkey === data.rkey) {
              data.handle = post.handle;
              data.indexedAt = post.indexedAt;
              data.nickname = post.nickname;
              p[1](data);
              break;
            }
          }
          break;

        case "delete":
          data = data as DeleteEvent;
          for (const [i, p] of posts().entries()) {
            let post = p[0]();
            if (post.did === data.did && post.rkey === data.rkey) {
              let all = untrack(posts);
              all.splice(i, 1);
              setPosts([...all]);
              break;
            }
          }
          break;
      }
    });
  });

  return (
    <div class="flex w-full flex-col items-center">
      <div>
        <button
          class="mt-3 bg-stone-600 px-1 py-1 font-bold text-white hover:bg-stone-700"
          onclick={async () => {
            cursor = cursor == 0 ? 100 : cursor;
            setPosts(posts().concat(await getPosts()));
            feedSize += MAXPOSTS;
          }}
        >
          Load More
        </button>
      </div>
      <div class="flex w-full flex-col-reverse">
        <For each={posts()}>
          {(record, idx) => (
            <PostItem
              isSamePoster={
                idx() < posts().length - 1 &&
                posts()[idx() + 1][0]().did === record[0]().did &&
                record[0]().indexedAt - posts()[idx() + 1][0]().indexedAt <
                  600000
              }
              firstUnread={idx() + 1 === unreadState().count}
              record={record[0]}
              markAsUnread={() =>
                setUnreadState({ count: idx() + 1, ignoreOnce: true })
              }
            />
          )}
        </For>
      </div>
    </div>
  );
};

export default PostFeed;
export type { PostFeedProps };
