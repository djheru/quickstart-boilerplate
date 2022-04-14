import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule, appModuleDocumentation } from './app.module';
import { LoggerService } from './logger/logger.service';

const { ADDRESS = '0.0.0.0', NAME, PORT = 4000 } = process.env;

async function bootstrap() {
  const logger = new LoggerService('ApplicationBootstrap');
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Ensure that unknown properties are stripped from the dto
      forbidNonWhitelisted: true, // Throw an error if unknown values are sent in the request
      transform: true, // Ensure that the request data is coerced to the correct type
      transformOptions: {
        enableImplicitConversion: true, // Automatically convert types with class-transformer
      },
    })
  );
  appModuleDocumentation(app);
  app.enableCors();
  await app.listen(PORT, ADDRESS);
  logger.log(`${NAME} API running at: ${ADDRESS}:${PORT}`);
}
bootstrap();
