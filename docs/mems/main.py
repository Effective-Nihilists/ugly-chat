from ugly_bot import *
import json
import time

# Modes: Comprehenion via: questions; defining words;
# Memorize via: Fill in the Blank; Visual cues and Symbols; Memory Palace; Recitating; Spaced Repetition/Review Recall (https://freshcardsapp.com/srs/write-your-own-algorithm.html);
# Bug: Bot needs to start every new quote with Comprehension mode. After it generated a new quote, it quickly moved onto FITB.
# Bug: After a quote is learned, it should pick up on the last quote being memorized, instead of going back to the first quote.

quotes = [
     {
        "title": "If a man would seek distinction",
        "quote": "If a man would seek distinction he should suffice himself with a frugal provision, seek to better the lot of the realm, choose the way of justice and fair mindedness, and tread the path of high-spirited service. Such a one, needy though he be, still win imperishable riches and attain unto everlasting honour.",
        "attribution": "from 'Abdu'l-Bahá in 'Lights of Guidance', page 453"
    },
    {
        "title": "The shining spark...",
        "quote": "The shining spark of truth cometh forth only after the clash of differing opinions.",
        "attribution": "from 'Abdu'l-Bahá in 'Selections from the Writings of Abdu'l-Baha', page 87"
    },
    {
        "title": "The betterment of the world...",
        "quote": "The betterment of the world can be accomplished through pure and goodly deeds, through commendable and seemly conduct.",
        "attribution": "from Bahá'u'lláh and cited in 'The Advent of Divine Justice', page 24"
    },
    {
        "title": "They who dwell within...",
        "quote": "They who dwell within the tabernacle of God, and are established upon the seats of everlasting glory, will refuse, though they be dying of hunger, to stretch their hands to seize unlawfully the property of their neighbor, however vile and worthless he may be.",
        "attribution": "from Bahá'u'lláh in 'Gleanings from the Writings of Baha'u'llah', page 298"
    },
    {
        "title": "Not everything that a man knoweth...",
        "quote": "Not everything that a man knoweth can be disclosed, nor can everything that he can disclose be regarded as timely, nor can every timely utterance be considered as suited to the capacity of those who hear it.",
        "attribution": "from a hadith quoted by Bahá'u'lláh in 'Gleanings from the Writings of Baha'u'llah', page 176"
    },
    {
        "title": "Ye are better known to...",
        "quote": "Ye are better known to the inmates of the Kingdom on high than ye are known to your own selves. Think ye these words to be vain and empty? Would that ye had the power to perceive the things your Lord, the All-Merciful, doth see -- things that attest the excellence of your rank, that bear witness to the greatness of your worth, that proclaim the sublimity of your station! God grant that your desires and unmortified passions may not hinder you from that which hath been ordained for you.",
        "attribution": "from Baha'u'llah in 'Gleanings from the Writings of Baha'u'llah', page 316"
    }
]

def comprehension(data):
    history = message_history(start=data.comprehension_start)
    history = [x for x in history if x.visibility == MessageVisibility.NORMAL]
    comprehension_history = [x for x in history if x.created > data.comprehension_last_time]
    print("HISTORY", comprehension_history)

    if comprehension_history:
        conversation = messages_to_text(messages=comprehension_history)
        json_response = text_gen(
            model=TextGenModel.TOGETHER_META_LLAMA_3_70B,
            instruction="You are a thoughtful study coach",
            max_tokens=60000,
            question=f"""
                Conversation is below:
                ---------------
                {conversation}
                --------------- 
                Quote is below:
                ---------------
                {data.quote}
                ---------------
                Based on the conversation and quote, compute a score from 1 to 10 of how well the user understands the quote by answering questions about the quote using exact words from the quote itself. If the user is not using the exacts words then the maximum score is 5.
        Only return JSON, do not explain.
        Return using JSON like this:
        {{
        "score": 10
        }}
    """)

        message_send(text=json_response)
        score = json.loads(json_response)["score"]

        if score >= 8:
            data = data_set(
                comprehension_correct_count=data.comprehension_correct_count + 1, 
                comprehension_last_time=int(time.time())
            )
            if data.comprehension_correct_count >= 3:
                message_send(text="Good job. Now let's work on memorizing the quote.")
                data_set(mode="memorizationFITB", memorization_start=int(time.time()))
                return
            else:
                message_send(
                    text=f"You got it right: {data.comprehension_correct_count} out of 3 required",
                    visibility=MessageVisiblity.SILENT,
                    color=MessageColor.ACCENT
                )

    text = text_gen(
        model="openai_gpt_4o",
        instruction=f"""
            You are role playing as an study coach who is helping people understand the literal meaning of the quote by asking basic comprehension questions. Your comprehension questions are based on exact words and phrases from the quote, where correct answers are rephrasings of the quote itself. Your questions do not ask for opinions or interpretations, and are limited to the words and phrases in the quote. You only ask one question at a time. For example, after reading the quotation, “The betterment of the world can be accomplished through pure and goodly deeds, through commendable and seemly conduct”, one of the questions you can ask is, “How can the betterment of the world be accomplished?”
            Encourage people to answer questions by rephrasing words from the quote. Discourage people from giving answers that do not rephrase the quote.
            You are teaching this quote "{data.quote}" attributed to {data.attribution}.
        """,
        messages=history
    )

    message_send(text=text)

def memorization_fitb(data):
    history = message_history(start=data.memorizationStart)
    if history:
        conversation = messages_to_text(messages=history)
        json_response = text_gen(
            model=TextGenModel.TOGETHER_META_LLAMA_3_70B,
            instruction="You are a thoughtful study coach",
            max_tokens=60000,
            question=f"""
                Conversation is below:
                ---------------
                {conversation}
                --------------- 
                Quote is below:
                ---------------
                {data.quote}
                ---------------
                Based on the conversation and quote, compute a score 1 to 10 of how well the user remembers the exact quote when filling in the missing words of the quote using the correct words. Ignore punctuation marks. Score based on difficulty. A score of 10 requires that 90 percent of the words to be missing.
                Only return JSON, do not explain.
                Return using JSON like this:
                {{
                "score": 10
                }}
            """
        )
        message_send(
            text=json_response, 
            visibility=MessageVisibility.SILENT,
            color=MessageColor.ACCENT
        )
        score = json.loads(json_response)["score"]
        if score >= 9:
            data = data_set(mode="start")
            message_send(text="Good job on memorization.")
            message_direct()
            return

    text = text_gen(
        model=TextGenModel.OPENAI_GPT_4O,
        instruction=f"""
            You are role playing as a study coach who is helping people memorize a quote. You ask people to fill in the blank. Each time they get it correct, you increase the difficulty by increasing the number of words that are replaced with a blank. You keep asking even when they know the quote. You are only satisfied that the person has memorized the quote when they can recite the entire quote by themselves. You only help memorize this quote. You do not offer any other quotes.
            You are teaching this quote "{data.quote}" attributed to {data.attribution}.
        """,
        messages=history
    )
    message_send(text=text)

def start_test(): 
    message_send(
        text= 'What quote would you like to study now?',
        buttons= [
            {
                "type": "button",
                "text": x["title"],
                "func": "set_quote",
                "params": x
            }
            for x in quotes
        ]
    )


def meeting_start(params: dict) -> None:
    # Assuming 'params' contains a 'meeting' key
    data_set(
        mode= 'start',
        meetingStart= int(time.time() * 1000)  # Milliseconds since epoch
    )
    message_direct()

@export("set_quote")
def set_quote(title, quote, attribution) -> None:
    # Set quote data
    data_set(
        quote= quote,
        attribution= attribution
    )
    
    # Format markdown message
    markdown = f"**{quote}**\n\n\n*{attribution}*"
    
    # Send message and create file
    message_send(markdown= markdown)
    file = file_create(
        type= FileType.MARKDOWN,
        markdown= markdown,
        title= 'Quote'
    )
    
    # Show file in conversation
    conversation_content_show(
        type= 'file',
        file_id= file.id,
        disabled= True
    )
    
    # Update mode and comprehension data
    data_set(
        mode= 'comprehension',
        comprehension_start= int(time.time() * 1000),
        comprehension_correct_count= 0,
        comprehension_last_time= int(time.time() * 1000)
    )
    message_direct()


@export("conversation_start")
def init():
    data_set(
        mode="start"
    )
    start_test()

@export("message_direct")
def message_direct():
    data = data_get()
    if data.mode == "start":
        start_test()
    elif data.mode == "comprehension":
        comprehension(data)
    elif data.mode == "memorizationFITB":
        memorization_fitb(data)

start()
