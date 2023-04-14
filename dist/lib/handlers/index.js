import { QuoteToRatioHandlerInjector } from './quote-to-ratio/injector';
import { QuoteToRatioHandler } from './quote-to-ratio/quote-to-ratio';
import { QuoteHandlerInjector } from './quote/injector';
import { QuoteHandler } from './quote/quote';
const quoteInjectorPromise = new QuoteHandlerInjector('quoteInjector').build();
const quoteToRatioInjectorPromise = new QuoteToRatioHandlerInjector('quoteToRatioInjector').build();
const quoteHandler = new QuoteHandler('quote', quoteInjectorPromise);
const quoteToRatioHandler = new QuoteToRatioHandler('quote-to-ratio', quoteToRatioInjectorPromise);
module.exports = {
    quoteHandler: quoteHandler.handler,
    quoteToRatioHandler: quoteToRatioHandler.handler,
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvaGFuZGxlcnMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sMkJBQTJCLENBQUE7QUFDdkUsT0FBTyxFQUFFLG1CQUFtQixFQUFFLE1BQU0saUNBQWlDLENBQUE7QUFDckUsT0FBTyxFQUFFLG9CQUFvQixFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDdkQsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLGVBQWUsQ0FBQTtBQUU1QyxNQUFNLG9CQUFvQixHQUFHLElBQUksb0JBQW9CLENBQUMsZUFBZSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUE7QUFDOUUsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLDJCQUEyQixDQUFDLHNCQUFzQixDQUFDLENBQUMsS0FBSyxFQUFFLENBQUE7QUFFbkcsTUFBTSxZQUFZLEdBQUcsSUFBSSxZQUFZLENBQUMsT0FBTyxFQUFFLG9CQUFvQixDQUFDLENBQUE7QUFDcEUsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLG1CQUFtQixDQUFDLGdCQUFnQixFQUFFLDJCQUEyQixDQUFDLENBQUE7QUFFbEcsTUFBTSxDQUFDLE9BQU8sR0FBRztJQUNmLFlBQVksRUFBRSxZQUFZLENBQUMsT0FBTztJQUNsQyxtQkFBbUIsRUFBRSxtQkFBbUIsQ0FBQyxPQUFPO0NBQ2pELENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBRdW90ZVRvUmF0aW9IYW5kbGVySW5qZWN0b3IgfSBmcm9tICcuL3F1b3RlLXRvLXJhdGlvL2luamVjdG9yJ1xuaW1wb3J0IHsgUXVvdGVUb1JhdGlvSGFuZGxlciB9IGZyb20gJy4vcXVvdGUtdG8tcmF0aW8vcXVvdGUtdG8tcmF0aW8nXG5pbXBvcnQgeyBRdW90ZUhhbmRsZXJJbmplY3RvciB9IGZyb20gJy4vcXVvdGUvaW5qZWN0b3InXG5pbXBvcnQgeyBRdW90ZUhhbmRsZXIgfSBmcm9tICcuL3F1b3RlL3F1b3RlJ1xuXG5jb25zdCBxdW90ZUluamVjdG9yUHJvbWlzZSA9IG5ldyBRdW90ZUhhbmRsZXJJbmplY3RvcigncXVvdGVJbmplY3RvcicpLmJ1aWxkKClcbmNvbnN0IHF1b3RlVG9SYXRpb0luamVjdG9yUHJvbWlzZSA9IG5ldyBRdW90ZVRvUmF0aW9IYW5kbGVySW5qZWN0b3IoJ3F1b3RlVG9SYXRpb0luamVjdG9yJykuYnVpbGQoKVxuXG5jb25zdCBxdW90ZUhhbmRsZXIgPSBuZXcgUXVvdGVIYW5kbGVyKCdxdW90ZScsIHF1b3RlSW5qZWN0b3JQcm9taXNlKVxuY29uc3QgcXVvdGVUb1JhdGlvSGFuZGxlciA9IG5ldyBRdW90ZVRvUmF0aW9IYW5kbGVyKCdxdW90ZS10by1yYXRpbycsIHF1b3RlVG9SYXRpb0luamVjdG9yUHJvbWlzZSlcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHF1b3RlSGFuZGxlcjogcXVvdGVIYW5kbGVyLmhhbmRsZXIsXG4gIHF1b3RlVG9SYXRpb0hhbmRsZXI6IHF1b3RlVG9SYXRpb0hhbmRsZXIuaGFuZGxlcixcbn1cbiJdfQ==